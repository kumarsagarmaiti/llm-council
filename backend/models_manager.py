"""Manager for Ollama models (list, pull, delete)."""

import httpx
import json
import asyncio
import re
import time
from typing import List, Dict, Any, Optional
from .ollama import OLLAMA_API_URL

OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags"
OLLAMA_PULL_URL = "http://127.0.0.1:11434/api/pull"
OLLAMA_DELETE_URL = "http://127.0.0.1:11434/api/delete"
DISCOVERY_CACHE_TTL_SECONDS = 300

CLOUD_ONLY_KEYWORDS = ['cloud', 'api only', 'api-only', 'hosted inference', 'cloud-hosted']
CLOUD_ONLY_MODELS = {'deepseek-v3.2', 'deepseek-v3'}

def _is_cloud_only(name: str, description: str) -> bool:
    if name in CLOUD_ONLY_MODELS:
        return True
    desc_lower = description.lower()
    return any(kw in desc_lower for kw in CLOUD_ONLY_KEYWORDS)

FALLBACK_LIBRARY_MODELS = [
    {"name": "llama3.2", "description": "Lightweight general-purpose model", "params": "3B", "type": "general", "base_family": "llama3.2"},
    {"name": "mistral", "description": "Balanced instruction model", "params": "7B", "type": "general", "base_family": "mistral"},
    {"name": "gemma2", "description": "Google open-weight family", "params": "9B", "type": "general", "base_family": "gemma2"},
    {"name": "deepseek-r1", "description": "Reasoning-focused local model", "params": "7B", "type": "reasoning", "base_family": "deepseek-r1"},
]

# Global tracker for active pull tasks and their progress
# format: { model_name: { "task": Task, "last_progress": dict } }
active_pulls = {}
library_cache = {"timestamp": 0.0, "models": []}

async def list_local_models() -> List[Dict[str, Any]]:
    """List models currently installed in Ollama."""
    urls = [OLLAMA_TAGS_URL, "http://localhost:11434/api/tags"]
    
    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    models = data.get("models", [])
                    print(f"Found {len(models)} local models via {url}")
                    return models
        except Exception as e:
            print(f"Ollama list failed for {url}: {type(e).__name__}")
            continue
            
    return []

async def delete_model(model_name: str) -> bool:
    """Delete a model from Ollama."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.request(
                "DELETE", 
                OLLAMA_DELETE_URL, 
                json={"name": model_name}
            )
            return response.status_code == 200
    except Exception as e:
        print(f"Error deleting model {model_name}: {e}")
        return False

async def get_active_pulls() -> Dict[str, Any]:
    """Get status of all currently active pulls."""
    return {
        name: data.get("last_progress", {"status": "starting"})
        for name, data in active_pulls.items()
    }

async def cancel_pull(model_name: str) -> bool:
    """Cancel an active pull task."""
    if model_name in active_pulls:
        active_pulls[model_name]["task"].cancel()
        print(f"Cancelled pull for {model_name}")
        return True
    return False

async def discover_ollama_library() -> List[Dict[str, Any]]:
    """Fetch popular models directly from Ollama.com/library."""
    now = time.time()
    if library_cache["models"] and now - library_cache["timestamp"] < DISCOVERY_CACHE_TTL_SECONDS:
        return [model.copy() for model in library_cache["models"]]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://ollama.com/library")
            if response.status_code != 200:
                fallback = [model.copy() for model in FALLBACK_LIBRARY_MODELS]
                library_cache.update({"timestamp": now, "models": fallback})
                return fallback
            
            html = response.text
            matches = re.finditer(r'href="/library/([a-zA-Z0-9.\-_]+)".*?<p[^>]*>(.*?)</p>', html, re.DOTALL)
            
            models = []
            seen = set()
            for match in matches:
                name = match.group(1)
                description = match.group(2).strip()
                if name in seen or name == "library": continue
                if _is_cloud_only(name, description): continue
                seen.add(name)
                
                params_match = re.search(r'(\d+(?:\.\d+)?)[bB]', description)
                params_str = params_match.group(0).upper() if params_match else ""
                
                models.append({
                    "name": name,
                    "description": description,
                    "params": params_str,
                    "type": "reasoning" if "deepseek" in name or "r1" in name else "general",
                    "base_family": name
                })
            if models:
                library_cache.update({"timestamp": now, "models": models})
                return [model.copy() for model in models]
    except Exception as e:
        print(f"Failed to discover Ollama library: {e}")

    fallback = [model.copy() for model in FALLBACK_LIBRARY_MODELS]
    library_cache.update({"timestamp": now, "models": fallback})
    return fallback

async def pull_model_stream(model_name: str):
    """Stream download progress and track state."""
    task = asyncio.current_task()
    active_pulls[model_name] = {"task": task, "last_progress": {"status": "starting"}}
    
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", OLLAMA_PULL_URL, json={"name": model_name}) as response:
                async for line in response.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            active_pulls[model_name]["last_progress"] = data
                            
                            if data.get("status") == "success":
                                yield f"data: {json.dumps({'status': 'success', 'completed': 100, 'total': 100})}\n\n"
                                break
                            yield f"data: {line}\n\n"
                        except json.JSONDecodeError:
                            yield f"data: {line}\n\n"
    except asyncio.CancelledError:
        print(f"Pull for {model_name} task was cancelled internally.")
        yield f"data: {json.dumps({'status': 'cancelled'})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    finally:
        if active_pulls.get(model_name) and active_pulls[model_name]["task"] == task:
            del active_pulls[model_name]

def estimate_ram_requirement(model_name: str) -> int:
    """Estimate minimum RAM (GB) needed based on model name tags."""
    match = re.search(r'(\d+(?:\.\d+)?)[bB]', model_name)
    if match:
        params = float(match.group(1))
        return max(4, int(params * 0.7) + 2)
    return 8
