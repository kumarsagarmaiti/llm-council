"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import uuid
import json
import asyncio

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from . import system_info
from . import models_manager

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
        stage3_result
    )

    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


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
        stage3_result
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

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(contextual_query, stage1_results, models_override=request.council_models)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

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
                stage3_result
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
