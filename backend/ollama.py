"""Ollama API client for local LLM requests."""

import httpx
from typing import List, Dict, Any, Optional

OLLAMA_API_URL = "http://127.0.0.1:11434/api/chat"


async def query_ollama(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 600.0
) -> Optional[Dict[str, Any]]:
    """
    Query a local model via Ollama API.
    """
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "num_ctx": 16384,
            "temperature": 0.6
        }
    }

    try:
        # Using a longer timeout and explicit IPv4 address
        async with httpx.AsyncClient(timeout=timeout) as client:
            print(f"Querying local model {model}...")
            response = await client.post(
                OLLAMA_API_URL,
                json=payload
            )
            
            if response.status_code != 200:
                print(f"Ollama returned error {response.status_code}: {response.text}")
                return None
                
            data = response.json()
            message = data.get('message', {})
            
            content = message.get('content', '')
            if not content:
                print(f"Warning: Ollama returned empty content for model {model}")
                
            reasoning = ""
            if "<think>" in content and "</think>" in content:
                parts = content.split("</think>")
                reasoning = parts[0].replace("<think>", "").strip()
                content = parts[1].strip()

            return {
                'content': content,
                'reasoning_details': reasoning
            }

    except httpx.ConnectError:
        print(f"Error: Could not connect to Ollama at {OLLAMA_API_URL}. Is Ollama running?")
        return None
    except Exception as e:
        print(f"Error querying Ollama model {model}: {type(e).__name__}: {e}")
        return None
