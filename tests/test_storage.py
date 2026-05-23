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

    def test_add_assistant_message_persists_metadata(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            conversation_id = "conv-metadata-test"
            with patch("backend.storage.DATA_DIR", tmpdir):
                storage.create_conversation(conversation_id)
                
                stage1 = [{"model": "alpha", "response": "Alpha answer"}]
                stage2 = []
                stage3 = {"model": "beta", "response": "synthesis"}
                metadata = {
                    "label_to_model": {"Response A": "alpha"},
                    "aggregate_rankings": [],
                    "failed_models": ["gamma"]
                }
                
                storage.add_assistant_message(
                    conversation_id,
                    stage1,
                    stage2,
                    stage3,
                    metadata
                )
                
                conversation = storage.get_conversation(conversation_id)
                
        self.assertEqual(len(conversation["messages"]), 1)
        self.assertEqual(conversation["messages"][0]["metadata"], metadata)

    def test_settings_obfuscation_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_file = Path(tmpdir) / "settings.json"
            
            with patch("backend.storage.SETTINGS_FILE", str(settings_file)):
                test_settings = {
                    "api_keys": {
                        "openai": "sk-openai-test-key-12345",
                        "anthropic": "sk-ant-test-key-67890",
                        "gemini": "",
                        "deepseek": "sk-ds-key",
                        "openrouter": ""
                    },
                    "enabled_cloud_models": ["openai:gpt-4o"],
                    "custom_cloud_models": []
                }
                
                # Save settings (should encrypt on disk)
                storage.save_settings(test_settings)
                
                # Verify that keys are not stored in plain text on disk
                with open(settings_file, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                    
                self.assertNotEqual(disk_data["api_keys"]["openai"], "sk-openai-test-key-12345")
                self.assertNotEqual(disk_data["api_keys"]["anthropic"], "sk-ant-test-key-67890")
                self.assertNotEqual(disk_data["api_keys"]["deepseek"], "sk-ds-key")
                self.assertEqual(disk_data["api_keys"]["gemini"], "")
                
                # Load settings (should decrypt/deobfuscate)
                loaded_settings = storage.get_settings()
                self.assertEqual(loaded_settings["api_keys"]["openai"], "sk-openai-test-key-12345")
                self.assertEqual(loaded_settings["api_keys"]["anthropic"], "sk-ant-test-key-67890")
                self.assertEqual(loaded_settings["api_keys"]["deepseek"], "sk-ds-key")
                self.assertEqual(loaded_settings["api_keys"]["gemini"], "")

    def test_settings_backward_compatibility_with_plain_text(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_file = Path(tmpdir) / "settings.json"
            
            # Write plain-text keys directly to settings.json
            legacy_settings = {
                "api_keys": {
                    "openai": "sk-legacy-plain-openai",
                    "anthropic": "",
                    "gemini": "gemini-legacy-key",
                    "deepseek": "",
                    "openrouter": ""
                },
                "enabled_cloud_models": ["openai:gpt-4o"],
                "custom_cloud_models": []
            }
            with open(settings_file, "w", encoding="utf-8") as f:
                json.dump(legacy_settings, f, indent=2)
                
            with patch("backend.storage.SETTINGS_FILE", str(settings_file)):
                loaded_settings = storage.get_settings()
                
            self.assertEqual(loaded_settings["api_keys"]["openai"], "sk-legacy-plain-openai")
            self.assertEqual(loaded_settings["api_keys"]["gemini"], "gemini-legacy-key")
            self.assertEqual(loaded_settings["api_keys"]["anthropic"], "")
