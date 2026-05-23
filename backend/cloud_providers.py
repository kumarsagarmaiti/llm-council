"""Direct cloud provider APIs (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter)."""

import os
import httpx
import logging
from typing import List, Dict, Any, Optional
from . import storage

logger = logging.getLogger(__name__)

# Curated list of popular cloud models that are available when keys are set
DEFAULT_CLOUD_MODELS = [
    {
        "name": "openai:gpt-4o",
        "provider": "OpenAI",
        "displayName": "GPT-4o",
        "description": "OpenAI's flagship high-intelligence model",
        "is_cloud": True,
    },
    {
        "name": "openai:gpt-4o-mini",
        "provider": "OpenAI",
        "displayName": "GPT-4o Mini",
        "description": "OpenAI's fast, lightweight cloud model",
        "is_cloud": True,
    },
    {
        "name": "anthropic:claude-3-5-sonnet-latest",
        "provider": "Anthropic",
        "displayName": "Claude 3.5 Sonnet",
        "description": "Anthropic's state-of-the-art model",
        "is_cloud": True,
    },
    {
        "name": "anthropic:claude-3-5-haiku-latest",
        "provider": "Anthropic",
        "displayName": "Claude 3.5 Haiku",
        "description": "Anthropic's fastest, highly capable model",
        "is_cloud": True,
    },
    {
        "name": "gemini:gemini-2.5-pro",
        "provider": "Gemini",
        "displayName": "Gemini 2.5 Pro",
        "description": "Google's premium model for complex tasks",
        "is_cloud": True,
    },
    {
        "name": "gemini:gemini-2.5-flash",
        "provider": "Gemini",
        "displayName": "Gemini 2.5 Flash",
        "description": "Google's fast, efficient cloud model",
        "is_cloud": True,
    },
    {
        "name": "deepseek:deepseek-chat",
        "provider": "DeepSeek",
        "displayName": "DeepSeek V3",
        "description": "DeepSeek's high-efficiency chat model",
        "is_cloud": True,
    },
    {
        "name": "deepseek:deepseek-reasoner",
        "provider": "DeepSeek",
        "displayName": "DeepSeek R1 (Cloud)",
        "description": "DeepSeek's reasoning model on the cloud",
        "is_cloud": True,
    },
    {
        "name": "openrouter:openai/gpt-4o",
        "provider": "OpenRouter",
        "displayName": "GPT-4o (OpenRouter)",
        "description": "GPT-4o routed via OpenRouter",
        "is_cloud": True,
    },
    {
        "name": "openrouter:anthropic/claude-3.5-sonnet",
        "provider": "OpenRouter",
        "displayName": "Claude 3.5 Sonnet (OpenRouter)",
        "description": "Claude 3.5 Sonnet routed via OpenRouter",
        "is_cloud": True,
    },
    {
        "name": "openrouter:google/gemini-2.5-pro",
        "provider": "OpenRouter",
        "displayName": "Gemini 2.5 Pro (OpenRouter)",
        "description": "Gemini 2.5 Pro routed via OpenRouter",
        "is_cloud": True,
    },
    {
        "name": "openrouter:deepseek/deepseek-chat",
        "provider": "OpenRouter",
        "displayName": "DeepSeek V3 (OpenRouter)",
        "description": "DeepSeek V3 routed via OpenRouter",
        "is_cloud": True,
    },
]


def get_api_key(provider: str) -> Optional[str]:
    """Get the API key for a provider from env vars or persistent settings."""
    env_var = f"{provider.upper()}_API_KEY"
    key = os.getenv(env_var)
    if key:
        return key

    settings = storage.get_settings()
    return settings.get("api_keys", {}).get(provider.lower())


def is_provider_configured(provider: str) -> bool:
    """Check if the API key for a provider is configured."""
    return bool(get_api_key(provider))


FRONTIER_KEYWORDS = [
    # OpenAI
    "gpt-4o", "gpt-4o-mini", "o1", "o3-mini", "gpt-4-turbo",
    # Anthropic
    "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus",
    # Gemini
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash",
    # DeepSeek
    "deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro", "deepseek-v4-flash",
]


def is_recommended_frontier_model(model_name: str) -> bool:
    """Check if the model is a recommended frontier model."""
    name_lower = model_name.lower()
    if ":" in name_lower:
        name_lower = name_lower.split(":", 1)[1]
    return any(kw in name_lower for kw in FRONTIER_KEYWORDS)


async def verify_key_and_fetch_models(provider: str, api_key: str) -> List[str]:
    """Test the connection for the API key and return a list of valid model identifiers."""
    provider = provider.lower()
    models = []
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        if provider == "openai":
            headers = {
                "Authorization": f"Bearer {api_key}",
            }
            response = await client.get("https://api.openai.com/v1/models", headers=headers)
            response.raise_for_status()
            data = response.json()
            for m in data.get("data", []):
                model_id = m.get("id", "")
                model_id_lower = model_id.lower()
                is_chat = (
                    model_id_lower.startswith("gpt-") or 
                    model_id_lower.startswith("o1-") or 
                    model_id_lower.startswith("o3-") or
                    model_id_lower == "o1" or
                    model_id_lower == "o3" or
                    model_id_lower.startswith("ft:gpt-")
                )
                if is_chat:
                    models.append(f"openai:{model_id}")
            models.sort()
                    
        elif provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
            response = await client.get("https://api.anthropic.com/v1/models", headers=headers)
            response.raise_for_status()
            data = response.json()
            for m in data.get("data", []):
                model_id = m.get("id", "")
                if model_id:
                    models.append(f"anthropic:{model_id}")
            models.sort()
                    
        elif provider == "gemini":
            headers = {
                "x-goog-api-key": api_key
            }
            response = await client.get("https://generativelanguage.googleapis.com/v1beta/models", headers=headers)
            response.raise_for_status()
            data = response.json()
            for m in data.get("models", []):
                name = m.get("name", "")
                if name.startswith("models/"):
                    model_id = name[len("models/"):]
                else:
                    model_id = name
                
                supported_methods = m.get("supportedGenerationMethods", [])
                if "generateContent" in supported_methods and model_id:
                    models.append(f"gemini:{model_id}")
            models.sort()
                    
        elif provider == "deepseek":
            headers = {
                "Authorization": f"Bearer {api_key}"
            }
            response = await client.get("https://api.deepseek.com/models", headers=headers)
            response.raise_for_status()
            data = response.json()
            for m in data.get("data", []):
                model_id = m.get("id", "")
                if model_id:
                    models.append(f"deepseek:{model_id}")
            models.sort()
                    
        elif provider == "openrouter":
            headers = {
                "Authorization": f"Bearer {api_key}"
            }
            response = await client.get("https://openrouter.ai/api/v1/models", headers=headers)
            response.raise_for_status()
            data = response.json()
            for m in data.get("data", []):
                model_id = m.get("id", "")
                is_non_chat = any(kw in model_id.lower() for kw in [
                    "embedding", "embed", "whisper", "dall-e", "stable-diffusion",
                    "tts", "flux", "cogvideo", "image", "video", "speech"
                ])
                if model_id and not is_non_chat:
                    models.append(f"openrouter:{model_id}")
            models.sort()
                    
        else:
            raise ValueError(f"Unknown provider: {provider}")
            
    return models


def is_cloud_model(model: str) -> bool:
    """Check if the model identifier represents a cloud model."""
    prefixes = ("openai:", "anthropic:", "gemini:", "deepseek:", "openrouter:")
    return model.startswith(prefixes) or "/" in model


async def query_openai(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query OpenAI chat completions API directly."""
    api_key = get_api_key("openai")
    if not api_key:
        logger.error("OpenAI API key is missing.")
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            return {
                "content": message.get("content"),
                "reasoning_details": message.get("reasoning_details")
            }
    except Exception as e:
        logger.error(f"Error querying OpenAI model {model}: {e}")
        return None


async def query_anthropic(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query Anthropic Messages API directly."""
    api_key = get_api_key("anthropic")
    if not api_key:
        logger.error("Anthropic API key is missing.")
        return None

    # Map roles if needed, Anthropic API doesn't support 'system' role in messages list directly,
    # but since this is a simple query, let's pass messages.
    # We should extract system prompt if present, or just pass system instruction as is or handle system role.
    system_prompt = None
    filtered_messages = []
    for msg in messages:
        if msg.get("role") == "system":
            system_prompt = msg.get("content")
        else:
            filtered_messages.append({
                "role": msg.get("role"),
                "content": msg.get("content")
            })

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": filtered_messages,
        "max_tokens": 4096,
    }
    if system_prompt:
        payload["system"] = system_prompt

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            
            # Anthropic returns content as a list of content blocks
            content_blocks = data.get("content", [])
            text_content = ""
            for block in content_blocks:
                if block.get("type") == "text":
                    text_content += block.get("text", "")

            return {
                "content": text_content,
                "reasoning_details": None
            }
    except Exception as e:
        logger.error(f"Error querying Anthropic model {model}: {e}")
        return None


async def query_gemini(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query Google Gemini API directly via its OpenAI-compatible endpoint."""
    api_key = get_api_key("gemini")
    if not api_key:
        logger.error("Gemini API key is missing.")
        return None

    # Google Gemini OpenAI-compatible endpoint
    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            return {
                "content": message.get("content"),
                "reasoning_details": message.get("reasoning_details")
            }
    except Exception as e:
        logger.error(f"Error querying Gemini model {model}: {e}")
        return None


async def query_deepseek(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query DeepSeek API directly."""
    api_key = get_api_key("deepseek")
    if not api_key:
        logger.error("DeepSeek API key is missing.")
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://api.deepseek.com/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            return {
                "content": message.get("content"),
                "reasoning_details": message.get("reasoning_details")
            }
    except Exception as e:
        logger.error(f"Error querying DeepSeek model {model}: {e}")
        return None


async def query_openrouter(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query OpenRouter API client directly."""
    api_key = get_api_key("openrouter")
    if not api_key:
        logger.error("OpenRouter API key is missing.")
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            return {
                "content": message.get("content"),
                "reasoning_details": message.get("reasoning_details")
            }
    except Exception as e:
        logger.error(f"Error querying OpenRouter model {model}: {e}")
        return None


async def query_cloud_model(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Optional[Dict[str, Any]]:
    """Query the appropriate cloud provider based on model identifier/prefix."""
    if model.startswith("openai:"):
        model_name = model.split(":", 1)[1]
        return await query_openai(model_name, messages, timeout)
    elif model.startswith("anthropic:"):
        model_name = model.split(":", 1)[1]
        return await query_anthropic(model_name, messages, timeout)
    elif model.startswith("gemini:"):
        model_name = model.split(":", 1)[1]
        return await query_gemini(model_name, messages, timeout)
    elif model.startswith("deepseek:"):
        model_name = model.split(":", 1)[1]
        return await query_deepseek(model_name, messages, timeout)
    elif model.startswith("openrouter:"):
        model_name = model.split(":", 1)[1]
        return await query_openrouter(model_name, messages, timeout)
    elif "/" in model:
        # Fallback/Legacy OpenRouter model
        return await query_openrouter(model, messages, timeout)
    else:
        logger.error(f"Unknown cloud model format: {model}")
        return None


def get_available_cloud_models() -> List[Dict[str, Any]]:
    """Get the list of cloud models configured/enabled by the user."""
    settings = storage.get_settings()
    enabled = settings.get("enabled_cloud_models", [])
    customs = settings.get("custom_cloud_models", [])

    results = []
    
    # We can create a map of DEFAULT_CLOUD_MODELS for quick lookup to preserve display names/descriptions
    default_map = {m["name"]: m for m in DEFAULT_CLOUD_MODELS}
    
    # Track which model names we have processed to avoid duplicates
    processed = set()
    
    # Process all models in enabled
    for name in enabled:
        if name in processed:
            continue
        processed.add(name)
        
        if name in default_map:
            model = default_map[name]
            provider = model["provider"].lower()
            model_copy = dict(model)
            model_copy["is_configured"] = is_provider_configured(provider)
            results.append(model_copy)
        else:
            # Dynamically parse provider and model ID
            if ":" in name:
                parts = name.split(":", 1)
                provider = parts[0].lower()
                model_id = parts[1]
            else:
                if "/" in name:
                    provider = "openrouter"
                    model_id = name
                    name = f"openrouter:{name}"
                else:
                    provider = "openai"
                    model_id = name
                    name = f"openai:{name}"
            
            if provider in ("openai", "anthropic", "gemini", "deepseek", "openrouter"):
                results.append({
                    "name": name,
                    "provider": provider.capitalize(),
                    "displayName": model_id,
                    "description": f"Cloud model on {provider.capitalize()}",
                    "is_cloud": True,
                    "is_configured": is_provider_configured(provider)
                })

    # Process customs
    for custom in customs:
        # Custom model ID can be provider:model_id
        provider = "openrouter" # default custom provider
        display_name = custom
        name = custom
        
        if ":" in custom:
            parts = custom.split(":", 1)
            prov = parts[0].lower()
            if prov in ("openai", "anthropic", "gemini", "deepseek", "openrouter"):
                provider = prov
                name = custom
                display_name = parts[1]
        else:
            # If no provider prefix, assume openrouter if it has a slash, or openai otherwise
            if "/" in custom:
                provider = "openrouter"
                name = f"openrouter:{custom}"
            else:
                provider = "openai"
                name = f"openai:{custom}"

        if name in processed:
            continue
        processed.add(name)

        results.append({
            "name": name,
            "provider": provider.capitalize(),
            "displayName": display_name,
            "description": f"Custom model on {provider.capitalize()}",
            "is_cloud": True,
            "is_configured": is_provider_configured(provider)
        })

    return results
