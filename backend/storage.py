"""JSON-based storage for conversations."""

import json
import os
import tempfile
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .council import build_stage3_fallback

DATA_DIR = os.getenv("LLM_COUNCIL_DATA_DIR", "data/conversations")


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def load_conversation_file(path: str) -> Optional[Dict[str, Any]]:
    """Load a JSON conversation file, skipping invalid entries."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            conversation = json.load(f)
            if not isinstance(conversation, dict):
                print(f"Skipping unreadable conversation file {path}: expected object, got {type(conversation).__name__}")
                return None
            return normalize_conversation(conversation)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Skipping unreadable conversation file {path}: {exc}")
        return None


def normalize_conversation(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """Repair legacy persisted shapes on read."""
    for message in conversation.get("messages", []):
        if message.get("role") != "assistant":
            continue

        stage3 = message.get("stage3")
        if not isinstance(stage3, dict):
            continue

        if stage3.get("response") != "Error: Unable to generate final synthesis.":
            continue

        message["stage3"] = build_stage3_fallback(
            stage3.get("model", "unknown"),
            message.get("stage1", []),
            message.get("stage2", []),
        )

    return conversation


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": []
    }

    # Save to file
    save_conversation(conversation)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    return load_conversation_file(path)


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    directory = os.path.dirname(path) or "."

    fd, temp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(conversation, f, indent=2)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            data = load_conversation_file(path)
            if data is None:
                continue
            conversation_id = data.get("id")
            created_at = data.get("created_at")
            messages = data.get("messages")
            if not conversation_id or not created_at or not isinstance(messages, list):
                print(f"Skipping malformed conversation file {path}: missing required fields")
                continue

            # Return metadata only
            conversations.append({
                "id": conversation_id,
                "created_at": created_at,
                "title": data.get("title", "New Conversation"),
                "message_count": len(messages)
            })

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any]
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3
    })

    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def delete_conversation(conversation_id: str) -> bool:
    """
    Delete a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        True if deleted, False otherwise
    """
    path = get_conversation_path(conversation_id)
    try:
        os.remove(path)
        return True
    except FileNotFoundError:
        return False
    return False
