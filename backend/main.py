"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
import io
import logging

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings, resolve_council_models
from . import system_info
from . import models_manager
from . import pdf_generator
from . import cloud_providers

logger = logging.getLogger(__name__)


class GeneratePdfRequest(BaseModel):
    """Request to generate a PDF from title and markdown content."""
    title: str
    content: str


app = FastAPI(title="LLM Council API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SettingsUpdateRequest(BaseModel):
    """Request to update persistent settings."""
    api_keys: Dict[str, str]
    enabled_cloud_models: List[str]
    custom_cloud_models: List[str]
    discovered_cloud_models: List[str] = []



class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    manual_responses: List[Dict[str, str]] = None
    chairman_model: str = None
    council_models: List[str] = None
    synthesis_profile: str = "auto"


def build_contextual_query(conversation: Dict[str, Any], new_content: str, max_messages: int = 6) -> str:
    """Build a follow-up query that includes recent conversation context."""
    messages = conversation.get("messages", [])
    if not messages:
        return new_content

    history_lines = []
    for message in messages[-max_messages:]:
        if message.get("role") == "user":
            history_lines.append(f"User: {message.get('content', '')}")
            continue

        if message.get("role") == "assistant":
            final_answer = (message.get("stage3") or {}).get("response", "")
            if final_answer:
                history_lines.append(f"Council: {final_answer}")

    if not history_lines:
        return new_content

    history_block = "\n".join(history_lines)
    return (
        "Continue the conversation using the prior context below.\n\n"
        f"Conversation so far:\n{history_block}\n\n"
        f"New user message: {new_content}"
    )


def require_local_request(request: Request):
    """Restrict machine-mutating operations to local callers."""
    client_host = request.client.host if request.client else None
    if client_host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(status_code=403, detail="This endpoint is available only from the local machine")


@app.get("/api/system/status")
async def get_system_status():
    """Get system hardware and Ollama status."""
    info = system_info.get_system_info()
    recommendations = await system_info.get_model_recommendations(info)
    return {
        "system": info,
        "recommendations": recommendations
    }


@app.get("/api/settings")
async def get_settings():
    """Get persistent settings (API keys & enabled cloud models)."""
    return storage.get_settings()


@app.post("/api/settings")
async def update_settings(request: SettingsUpdateRequest):
    """Update persistent settings after validating new API keys."""
    # Load current settings to compare keys
    old_settings = storage.get_settings()
    old_keys = old_settings.get("api_keys", {})
    
    enabled_cloud_models = list(request.enabled_cloud_models)
    discovered_cloud_models = list(request.discovered_cloud_models)
    
    for provider in ["openai", "anthropic", "gemini", "deepseek", "openrouter"]:
        old_key = old_keys.get(provider, "")
        new_key = request.api_keys.get(provider, "")
        
        provider_discovered = [m for m in discovered_cloud_models if m.startswith(f"{provider}:")]
        
        # If the key changed, or we have a key but no discovered models for this provider
        if new_key != old_key or (new_key and not provider_discovered):
            if not new_key:
                # Key was removed. Remove all models starting with provider:
                enabled_cloud_models = [m for m in enabled_cloud_models if not m.startswith(f"{provider}:")]
                discovered_cloud_models = [m for m in discovered_cloud_models if not m.startswith(f"{provider}:")]
            else:
                # Key was added or updated. Validate it and fetch its models.
                try:
                    fetched_models = await cloud_providers.verify_key_and_fetch_models(provider, new_key)
                    
                    # 1. Update discovered models list
                    discovered_cloud_models = [m for m in discovered_cloud_models if not m.startswith(f"{provider}:")]
                    discovered_cloud_models.extend(fetched_models)
                    
                    # 2. Update enabled models list (clear existing first, keep deselected by default)
                    enabled_cloud_models = [m for m in enabled_cloud_models if not m.startswith(f"{provider}:")]
                except Exception as e:
                    logger.error(f"Failed to validate {provider} API key: {e}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to validate {provider.capitalize()} API key: {str(e)}"
                    )
                    
    # Save the updated settings (including updated lists)
    updated_data = request.dict()
    updated_data["enabled_cloud_models"] = enabled_cloud_models
    updated_data["discovered_cloud_models"] = discovered_cloud_models
    storage.save_settings(updated_data)
    return {"status": "success"}


@app.get("/api/models")
async def list_all_models():
    """List both local Ollama models and enabled cloud models."""
    local_models = await models_manager.list_local_models()
    for model in local_models:
        model["is_cloud"] = False
        
    cloud_models = cloud_providers.get_available_cloud_models()
    
    # Combined list
    all_models = []
    all_models.extend(local_models)
    all_models.extend(cloud_models)
    
    return {
        "local": local_models,
        "cloud": cloud_models,
        "all": all_models
    }


@app.get("/api/models/local")
async def list_local_models():
    """List currently installed Ollama models."""
    return await models_manager.list_local_models()


@app.get("/api/models/active_pulls")
async def get_active_pulls():
    """Get any ongoing model downloads."""
    return await models_manager.get_active_pulls()


@app.post("/api/models/pull")
async def pull_model(model_name: str, request: Request):
    """Stream model download progress."""
    require_local_request(request)
    return StreamingResponse(
        models_manager.pull_model_stream(model_name),
        media_type="text/event-stream"
    )


@app.post("/api/models/cancel_pull")
async def cancel_pull(model_name: str, request: Request):
    """Cancel an active model download."""
    require_local_request(request)
    success = await models_manager.cancel_pull(model_name)
    return {"status": "success" if success else "not_found"}


@app.delete("/api/models/{model_name:path}")
async def delete_model(model_name: str, request: Request):
    """Delete a local Ollama model."""
    require_local_request(request)
    success = await models_manager.delete_model(model_name)
    if not success:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"status": "success"}


@app.post("/api/system/install_ollama")
async def install_ollama(request: Request):
    """Trigger the Ollama installation script and stream logs."""
    require_local_request(request)
    import platform
    import subprocess
    
    async def log_generator():
        try:
            system = platform.system()
            if system == "Darwin" or system == "Linux":
                cmd = "curl -fsSL https://ollama.com/install.sh | sh"
                process = await asyncio.create_subprocess_shell(
                    cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT
                )
                
                yield f"data: {json.dumps({'status': 'running', 'message': f'Starting install on {system}...'})}\n\n"
                
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    yield f"data: {json.dumps({'status': 'running', 'message': line.decode().strip()})}\n\n"
                
                await process.wait()
                if process.returncode == 0:
                    yield f"data: {json.dumps({'status': 'success', 'message': 'Ollama installed successfully!'})}\n\n"
                else:
                    yield f"data: {json.dumps({'status': 'error', 'message': 'Installation failed. Please try manual install.'})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'message': f'Auto-install not supported on {system}. Please visit ollama.com'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(log_generator(), media_type="text/event-stream")


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[Dict[str, Any]])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations")
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    success = storage.delete_conversation(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "success"}


@app.post("/api/conversations/{conversation_id}/manual_message")
async def send_manual_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message with manual Stage 1 responses.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0
    contextual_query = build_contextual_query(conversation, request.content)

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Use provided manual responses for Stage 1
    stage1_results = []
    if request.manual_responses:
        for res in request.manual_responses:
            stage1_results.append({
                "model": res.get("model", "Unknown"),
                "response": res.get("response", "")
            })
    
    # If no manual responses, run default Stage 1 (querying models)
    if not stage1_results:
        stage1_results = await stage1_collect_responses(contextual_query, models_override=request.council_models)

    # Stage 2: Empty for manual mode
    stage2_results = []
    metadata = {}
    
    # Run Stage 3: Synthesize final answer using dynamic chairman
    stage3_result = await stage3_synthesize_final(
        contextual_query,
        stage1_results,
        stage2_results,
        chairman_override=request.chairman_model,
        synthesis_profile=request.synthesis_profile,
    )

    # Add assistant message
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata
    )

    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/manual_message_with_files")
async def send_manual_message_with_files(
    conversation_id: str,
    content: str = Form(...),
    chairman_model: str = Form(None),
    synthesis_profile: str = Form("auto"),
    manual_responses: Optional[str] = Form(None),
    files: Optional[List[UploadFile]] = File(None)
):
    """
    Send a message in manual mode, supporting uploading PDF/text files and pasted manual responses.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0
    contextual_query = build_contextual_query(conversation, content)

    # Add user message
    storage.add_user_message(conversation_id, content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(content)
        storage.update_conversation_title(conversation_id, title)

    # Compile stage 1 results
    stage1_results = []
    
    # 1. Parse manual responses JSON if provided
    if manual_responses:
        try:
            parsed_manual = json.loads(manual_responses)
            for res in parsed_manual:
                stage1_results.append({
                    "model": res.get("model", "Unknown"),
                    "response": res.get("response", "")
                })
        except Exception as e:
            logger.warning(f"Failed to parse manual_responses JSON: {e}")

    # 2. Extract text from uploaded files (PDF, txt, md)
    if files:
        for file in files:
            file_content = await file.read()
            filename = file.filename or "uploaded_file"
            extracted_text = ""
            
            if filename.lower().endswith(".pdf"):
                try:
                    from pypdf import PdfReader
                    pdf_file = io.BytesIO(file_content)
                    reader = PdfReader(pdf_file)
                    text_parts = []
                    for page in reader.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(page_text)
                    extracted_text = "\n".join(text_parts).strip()
                except Exception as e:
                    logger.exception(f"Failed to extract PDF text from {filename}")
                    extracted_text = f"[Error reading PDF {filename}: {str(e)}]"
            elif filename.lower().endswith((".txt", ".md", ".json", ".csv")):
                try:
                    extracted_text = file_content.decode("utf-8", errors="replace").strip()
                except Exception as e:
                    logger.exception(f"Failed to read text file {filename}")
                    extracted_text = f"[Error reading file {filename}: {str(e)}]"
            else:
                # Try to decode as text as fallback
                try:
                    extracted_text = file_content.decode("utf-8", errors="replace").strip()
                except Exception:
                    extracted_text = f"[Unsupported file type: {filename}]"
            
            stage1_results.append({
                "model": filename,
                "response": extracted_text
            })

    # If absolutely no inputs provided, raise error
    if not stage1_results:
        raise HTTPException(
            status_code=400,
            detail="Please provide at least one uploaded file or manual response text."
        )

    # Stage 2: Empty for manual mode
    stage2_results = []
    metadata = {}
    
    # Run Stage 3: Synthesize final answer using dynamic chairman
    stage3_result = await stage3_synthesize_final(
        contextual_query,
        stage1_results,
        stage2_results,
        chairman_override=chairman_model,
        synthesis_profile=synthesis_profile,
    )

    # Add assistant message
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata
    )

    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/pdf/generate")
async def generate_pdf_endpoint(request: GeneratePdfRequest):
    """Generate a PDF from title and markdown content."""
    try:
        pdf_stream = pdf_generator.generate_pdf(request.title, request.content)
        safe_title = "".join(c for c in request.title if c.isalnum() or c in (" ", "-", "_")).strip()
        filename = f"{safe_title.replace(' ', '_').lower() or 'report'}.pdf"
        return StreamingResponse(
            pdf_stream,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        logger.exception("Failed to generate PDF")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {str(e)}")


@app.post("/api/conversations/{conversation_id}/retry_synthesis")
async def retry_synthesis(
    conversation_id: str,
    chairman_model: str = None,
    synthesis_profile: str = "auto",
):
    """
    Retry Stage 3 synthesis for the last assistant message.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if not conversation["messages"]:
        raise HTTPException(status_code=400, detail="No messages to retry")

    # Find the last assistant message
    last_assistant_msg_idx = -1
    for i in range(len(conversation["messages"]) - 1, -1, -1):
        if conversation["messages"][i]["role"] == "assistant":
            last_assistant_msg_idx = i
            break

    if last_assistant_msg_idx == -1:
        raise HTTPException(status_code=400, detail="No assistant message found to retry")

    # Find the user message before it for the query
    user_query = ""
    for i in range(last_assistant_msg_idx - 1, -1, -1):
        if conversation["messages"][i]["role"] == "user":
            user_query = conversation["messages"][i]["content"]
            break

    if not user_query:
        raise HTTPException(status_code=400, detail="Could not find original user query")

    assistant_msg = conversation["messages"][last_assistant_msg_idx]
    stage1_results = assistant_msg.get("stage1", [])
    stage2_results = assistant_msg.get("stage2", [])

    if not stage1_results:
        raise HTTPException(status_code=400, detail="No Stage 1 results found to synthesize")

    # Run Stage 3 synthesis again with dynamic chairman
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        chairman_override=chairman_model,
        synthesis_profile=synthesis_profile,
    )

    # Update the message in storage
    conversation["messages"][last_assistant_msg_idx]["stage3"] = stage3_result
    storage.save_conversation(conversation)

    return {
        "stage3": stage3_result
    }


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0
    contextual_query = build_contextual_query(conversation, request.content)

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        contextual_query,
        council_models=request.council_models,
        chairman_model=request.chairman_model,
        synthesis_profile=request.synthesis_profile,
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0
    contextual_query = build_contextual_query(conversation, request.content)

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(contextual_query, models_override=request.council_models)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            target_models = await resolve_council_models(request.council_models)
            responded_models = {res["model"] for res in stage1_results}
            failed_models = [m for m in target_models if m not in responded_models]

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(contextual_query, stage1_results, models_override=request.council_models)
            
            # Calculate Stage 2 failures
            responded_ranking_models = {res["model"] for res in stage2_results}
            for m in target_models:
                if len(stage1_results) >= 2 and m not in responded_ranking_models and m not in failed_models:
                    failed_models.append(m)

            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            metadata = {
                'label_to_model': label_to_model,
                'aggregate_rankings': aggregate_rankings,
                'failed_models': failed_models
            }
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': metadata})}\n\n"

            # Stage 3: Synthesize final answer using dynamic chairman
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                contextual_query, 
                stage1_results, 
                stage2_results,
                chairman_override=request.chairman_model,
                synthesis_profile=request.synthesis_profile,
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                metadata
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
