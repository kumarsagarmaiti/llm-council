import unittest
import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.main import app


class MainApiTests(unittest.TestCase):
    def test_delete_model_endpoint_exists(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")

        with patch("backend.main.models_manager.delete_model", new=AsyncMock(return_value=True)):
            response = client.delete("/api/models/llama3.1:latest")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "success"})

    def test_retry_synthesis_passes_synthesis_profile(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")
        conversation = {
            "id": "conv-1",
            "messages": [
                {"role": "user", "content": "Marketing strategy for Sift"},
                {
                    "role": "assistant",
                    "stage1": [{"model": "alpha", "response": "one"}],
                    "stage2": [],
                    "stage3": {"model": "alpha", "response": "old"},
                },
            ],
        }

        with (
            patch("backend.main.storage.get_conversation", return_value=conversation),
            patch("backend.main.storage.save_conversation"),
            patch(
                "backend.main.stage3_synthesize_final",
                new=AsyncMock(return_value={"model": "alpha", "response": "new", "synthesis_profile": "strategic"}),
            ) as mock_stage3,
        ):
            response = client.post(
                "/api/conversations/conv-1/retry_synthesis",
                params={"chairman_model": "alpha", "synthesis_profile": "strategic"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stage3"]["synthesis_profile"], "strategic")
        mock_stage3.assert_awaited_once_with(
            "Marketing strategy for Sift",
            [{"model": "alpha", "response": "one"}],
            [],
            chairman_override="alpha",
            synthesis_profile="strategic",
        )

    def test_message_stream_uses_event_stream_content_type(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")

        with (
            patch("backend.main.storage.get_conversation", return_value={"id": "conv-1", "messages": []}),
            patch("backend.main.storage.add_user_message"),
            patch("backend.main.storage.add_assistant_message"),
            patch("backend.main.storage.update_conversation_title"),
            patch("backend.main.generate_conversation_title", new=AsyncMock(return_value="Title")),
            patch("backend.main.stage1_collect_responses", new=AsyncMock(return_value=[{"model": "alpha", "response": "one"}])),
            patch("backend.main.stage2_collect_rankings", new=AsyncMock(return_value=([], {}))),
            patch("backend.main.calculate_aggregate_rankings", return_value=[]),
            patch("backend.main.stage3_synthesize_final", new=AsyncMock(return_value={"model": "alpha", "response": "one"})),
        ):
            response = client.post(
                "/api/conversations/conv-1/message/stream",
                json={
                    "content": "hello",
                    "council_models": ["alpha"],
                    "chairman_model": "alpha",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))

    def test_message_stream_uses_conversation_context_for_followup(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")
        conversation = {
            "id": "conv-1",
            "messages": [
                {"role": "user", "content": "Tell me about Sift"},
                {
                    "role": "assistant",
                    "stage3": {"model": "alpha", "response": "Sift is a personalized news app."},
                },
            ],
        }

        with (
            patch("backend.main.storage.get_conversation", return_value=conversation),
            patch("backend.main.storage.add_user_message"),
            patch("backend.main.storage.add_assistant_message"),
            patch("backend.main.storage.update_conversation_title"),
            patch("backend.main.stage1_collect_responses", new=AsyncMock(return_value=[{"model": "alpha", "response": "one"}])) as mock_stage1,
            patch("backend.main.stage2_collect_rankings", new=AsyncMock(return_value=([], {}))),
            patch("backend.main.calculate_aggregate_rankings", return_value=[]),
            patch("backend.main.stage3_synthesize_final", new=AsyncMock(return_value={"model": "alpha", "response": "one"})),
        ):
            response = client.post(
                "/api/conversations/conv-1/message/stream",
                json={
                    "content": "What should I do next?",
                    "council_models": ["alpha"],
                    "chairman_model": "alpha",
                },
            )

        self.assertEqual(response.status_code, 200)
        contextual_query = mock_stage1.await_args.args[0]
        self.assertIn("Tell me about Sift", contextual_query)
        self.assertIn("Sift is a personalized news app.", contextual_query)
        self.assertIn("New user message: What should I do next?", contextual_query)

    def test_send_manual_message_with_files_endpoint(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")
        conversation = {
            "id": "conv-1",
            "messages": []
        }
        
        manual_responses = [
            {"model": "gpt-4", "response": "Manual response content"}
        ]
        
        file_data = b"This is content from uploaded txt file."
        
        with (
            patch("backend.main.storage.get_conversation", return_value=conversation),
            patch("backend.main.storage.add_user_message"),
            patch("backend.main.storage.add_assistant_message"),
            patch("backend.main.storage.update_conversation_title"),
            patch("backend.main.generate_conversation_title", new=AsyncMock(return_value="Title")),
            patch(
                "backend.main.stage3_synthesize_final",
                new=AsyncMock(return_value={"model": "alpha", "response": "synthesized final response", "synthesis_profile": "auto"}),
            ) as mock_stage3,
        ):
            response = client.post(
                "/api/conversations/conv-1/manual_message_with_files",
                data={
                    "content": "Synthesize this data",
                    "chairman_model": "alpha",
                    "synthesis_profile": "auto",
                    "manual_responses": json.dumps(manual_responses)
                },
                files=[
                    ("files", ("test_file.txt", file_data, "text/plain"))
                ]
            )
            
        self.assertEqual(response.status_code, 200)
        json_data = response.json()
        self.assertEqual(len(json_data["stage1"]), 2)
        self.assertEqual(json_data["stage1"][0]["model"], "gpt-4")
        self.assertEqual(json_data["stage1"][1]["model"], "test_file.txt")
        self.assertEqual(json_data["stage1"][1]["response"], "This is content from uploaded txt file.")
        self.assertEqual(json_data["stage3"]["response"], "synthesized final response")

    def test_generate_pdf_endpoint(self):
        client = TestClient(app, base_url="http://127.0.0.1:8001")
        
        response = client.post(
            "/api/pdf/generate",
            json={
                "title": "Test Title",
                "content": "Test markdown content"
            }
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertIn("attachment; filename=test_title.pdf", response.headers["content-disposition"])
