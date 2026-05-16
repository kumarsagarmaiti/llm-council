import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import storage
from backend.council import build_stage3_fallback


class StorageTests(unittest.TestCase):
    def test_list_conversations_skips_corrupt_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            good = data_dir / "good.json"
            bad = data_dir / "bad.json"

            good.write_text(
                json.dumps(
                    {
                        "id": "good",
                        "created_at": "2026-05-15T00:00:00",
                        "title": "Good",
                        "messages": [],
                    }
                )
            )
            bad.write_text("{ not valid json")

            with patch("backend.storage.DATA_DIR", tmpdir):
                conversations = storage.list_conversations()

        self.assertEqual(
            conversations,
            [
                {
                    "id": "good",
                    "created_at": "2026-05-15T00:00:00",
                    "title": "Good",
                    "message_count": 0,
                }
            ],
        )

    def test_get_conversation_repairs_legacy_stage3_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            conversation_id = "conv-1"
            data_dir = Path(tmpdir)
            conversation_path = data_dir / f"{conversation_id}.json"
            conversation_path.write_text(
                json.dumps(
                    {
                        "id": conversation_id,
                        "created_at": "2026-05-15T00:00:00",
                        "title": "Recovered",
                        "messages": [
                            {"role": "user", "content": "question"},
                            {
                                "role": "assistant",
                                "stage1": [
                                    {"model": "alpha", "response": "Alpha answer"},
                                    {"model": "beta", "response": "Beta answer"},
                                ],
                                "stage2": [],
                                "stage3": {
                                    "model": "deepseek-r1:14b",
                                    "response": "Error: Unable to generate final synthesis.",
                                },
                            },
                        ],
                    }
                )
            )

            with patch("backend.storage.DATA_DIR", tmpdir):
                conversation = storage.get_conversation(conversation_id)

        self.assertEqual(
            conversation["messages"][-1]["stage3"],
            build_stage3_fallback(
                "deepseek-r1:14b",
                [
                    {"model": "alpha", "response": "Alpha answer"},
                    {"model": "beta", "response": "Beta answer"},
                ],
                [],
            ),
        )
