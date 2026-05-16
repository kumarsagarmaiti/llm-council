"""Hardware discovery and system status utilities."""

import platform
import subprocess
import shutil
import os
import re

def get_ram_fallback():
    """Fallback to get RAM info without psutil."""
    try:
        if platform.system() == "Darwin":
            # macOS: sysctl hw.memsize
            output = subprocess.check_output(["sysctl", "-n", "hw.memsize"]).decode("utf-8")
            return round(int(output.strip()) / (1024**3), 2)
        elif platform.system() == "Linux":
            # Linux: /proc/meminfo
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if "MemTotal" in line:
                        kb = int(line.split()[1])
                        return round(kb / (1024**2), 2)
    except Exception:
        pass
    return 0.0

def get_system_info():
    """Get hardware specifications and Ollama status."""
    import httpx
    
    # Try to import psutil inside the function
    try:
        import psutil
        total_ram = round(psutil.virtual_memory().total / (1024**3), 2)
        available_ram = round(psutil.virtual_memory().available / (1024**3), 2)
        cpu_count = psutil.cpu_count()
        # Disk check
        disk_usage = psutil.disk_usage('/')
        available_disk = round(disk_usage.free / (1024**3), 2)
    except Exception:
        total_ram = get_ram_fallback()
        available_ram = total_ram
        cpu_count = os.cpu_count() or 0
        available_disk = 100.0 # Default fallback

    info = {
        "os": platform.system(),
        "processor": platform.machine(),
        "total_ram_gb": total_ram,
        "available_ram_gb": available_ram,
        "available_disk_gb": available_disk,
        "cpu_count": cpu_count,
        "ollama_installed": False,
        "is_apple_silicon": False
    }

    # Binary check
    if shutil.which("ollama"):
        info["ollama_installed"] = True
    else:
        # Fallback: API check
        try:
            with httpx.Client(timeout=1.0) as client:
                resp = client.get("http://127.0.0.1:11434/api/tags")
                if resp.status_code == 200:
                    info["ollama_installed"] = True
        except Exception:
            pass

    # Detect Apple Silicon and Chip Name
    if info["os"] == "Darwin":
        try:
            output = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"]).decode("utf-8")
            if output:
                info["chip_name"] = output.strip()
                info["processor"] = info["chip_name"]
                if "Apple" in output:
                    info["is_apple_silicon"] = True
        except Exception:
            pass

    return info

# Enhanced metadata for popular models
MODEL_METADATA = {
    "deepseek-r1": {
        "strengths": "State-of-the-art chain-of-thought reasoning and logic.",
        "weaknesses": "Slower inference due to reasoning steps.",
        "default_params": "7B"
    },
    "llama3": {
        "strengths": "Fast, versatile, and huge knowledge base.",
        "weaknesses": "No specialized reasoning steps.",
        "default_params": "8B"
    },
    "phi3": {
        "strengths": "Ultra-fast, tiny footprint, great logic for its size.",
        "weaknesses": "Limited world knowledge.",
        "default_params": "3.8B"
    },
    "mistral": {
        "strengths": "Reliable, open, and great for standard tasks.",
        "weaknesses": "Slightly less capable than Llama 3.",
        "default_params": "7B"
    },
    "gemma2": {
        "strengths": "Google's lightweight model family with great multilingual support.",
        "weaknesses": "Higher RAM overhead than similar sized models.",
        "default_params": "9B"
    }
}

async def get_model_recommendations(system_info):
    """Fetch live models and calculate recommendations based on REAL-TIME machine resources."""
    from . import models_manager
    total_ram = system_info["total_ram_gb"]
    avail_ram = system_info["available_ram_gb"]
    avail_disk = system_info["available_disk_gb"]

    # Live discovery from Ollama.com/library
    base_models = await models_manager.discover_ollama_library()

    # Enrichment and Calculation
    for model in base_models:
        name = model["name"]
        params_str = model.get("params", "")
        
        family_id = next((f for f in MODEL_METADATA if f in name), None)
        meta = MODEL_METADATA.get(family_id, {})
        
        if not params_str and "default_params" in meta:
            params_str = meta["default_params"]
            model["params"] = params_str
        
        # Estimate RAM requirement
        params_match = re.search(r'(\d+(?:\.\d+)?)', params_str)
        if params_match:
            try:
                params_val = float(params_match.group(1))
                est_min_ram = max(4, int(params_val * 0.7) + 2)
            except ValueError:
                est_min_ram = 8
        else:
            est_min_ram = 7 if "llama" in name or "mistral" in name else 4
            if "deepseek-r1" in name: est_min_ram = 8

        model["min_ram_gb"] = est_min_ram
        model["size_gb"] = round(est_min_ram * 0.8, 1)
        actual_file_size = model["size_gb"]

        # 1. Real-Time Storage Check
        if actual_file_size > avail_disk:
            model["storage_status"] = "Insufficient Storage"
            model["can_install"] = False
        else:
            model["storage_status"] = "Space Available"
            model["can_install"] = True

        # 2. Dynamic Recommendation (Based on Machine Capacity)
        if total_ram >= est_min_ram * 1.5:
            model["recommendation"] = "Highly Recommended"
            model["status"] = "optimal"
        elif total_ram >= est_min_ram:
            model["recommendation"] = "Recommended"
            model["status"] = "compatible"
        else:
            model["recommendation"] = "Heavy for your machine"
            model["status"] = "heavy"

        # 3. Real-Time RAM Warning (Based on Currently FREE RAM)
        if avail_ram < est_min_ram:
            model["ram_warning"] = f"Close other apps to run (Needs {est_min_ram}GB, you have {avail_ram}GB free)"
        else:
            model["ram_warning"] = None

        # 4. Dynamic Efficiency Score
        usage_ratio = est_min_ram / total_ram if total_ram > 0 else 1.0
        if usage_ratio <= 0.2: model["efficiency"] = "ultra"
        elif usage_ratio <= 0.5: model["efficiency"] = "high"
        elif usage_ratio <= 0.8: model["efficiency"] = "medium"
        else: model["efficiency"] = "low"

        # Metadata
        if family_id:
            family_base = family_id.replace("-", " ").title()
            model["family"] = family_base
            model["strengths"] = meta.get("strengths")
            model["weaknesses"] = meta.get("weaknesses")
        else:
            clean_name = name.replace("-", " ").title()
            model["family"] = clean_name

    return {
        "models": base_models,
        "last_updated": None
    }
