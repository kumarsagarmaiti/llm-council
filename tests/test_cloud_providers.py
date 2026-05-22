import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from backend import cloud_providers
from backend import storage


class CloudProvidersTests(unittest.IsolatedAsyncioTestCase):
    @patch("backend.storage.get_settings")
    @patch.dict("os.environ", {}, clear=True)
    def test_get_api_key_from_settings(self, mock_get_settings):
        mock_get_settings.return_value = {
            "api_keys": {
                "openai": "settings-openai-key",
                "anthropic": "",
            }
        }
        # Check settings retrieval
        key = cloud_providers.get_api_key("openai")
        self.assertEqual(key, "settings-openai-key")

        # Check empty key
        key = cloud_providers.get_api_key("anthropic")
        self.assertEqual(key, "")

    @patch("backend.storage.get_settings")
    @patch.dict("os.environ", {"OPENAI_API_KEY": "env-openai-key"}, clear=True)
    def test_get_api_key_from_env_takes_precedence(self, mock_get_settings):
        mock_get_settings.return_value = {
            "api_keys": {
                "openai": "settings-openai-key"
            }
        }
        # Env key should take precedence
        key = cloud_providers.get_api_key("openai")
        self.assertEqual(key, "env-openai-key")

    def test_is_cloud_model(self):
        self.assertTrue(cloud_providers.is_cloud_model("openai:gpt-4o"))
        self.assertTrue(cloud_providers.is_cloud_model("anthropic:claude-3-5-sonnet-latest"))
        self.assertTrue(cloud_providers.is_cloud_model("openrouter:openai/gpt-4o"))
        self.assertTrue(cloud_providers.is_cloud_model("meta-llama/llama-3-70b-instruct")) # openrouter legacy/fallback format
        self.assertFalse(cloud_providers.is_cloud_model("llama3.2"))
        self.assertFalse(cloud_providers.is_cloud_model("mistral:latest"))

    @patch("backend.storage.get_settings")
    @patch("backend.cloud_providers.get_api_key")
    def test_get_available_cloud_models(self, mock_get_api_key, mock_get_settings):
        mock_get_settings.return_value = {
            "enabled_cloud_models": ["openai:gpt-4o", "anthropic:claude-3-5-sonnet-latest"],
            "custom_cloud_models": ["openrouter:meta-llama/llama-3-8b-instruct", "deepseek:custom-deepseek"]
        }
        
        def mock_get_key(provider):
            if provider == "openai":
                return "configured-key"
            return None
        mock_get_api_key.side_effect = mock_get_key

        models = cloud_providers.get_available_cloud_models()
        model_names = [m["name"] for m in models]
        
        # Check enabled defaults and customs are present
        self.assertIn("openai:gpt-4o", model_names)
        self.assertIn("anthropic:claude-3-5-sonnet-latest", model_names)
        self.assertIn("openrouter:meta-llama/llama-3-8b-instruct", model_names)
        self.assertIn("deepseek:custom-deepseek", model_names)
        
        # Check configuration status
        openai_model = next(m for m in models if m["name"] == "openai:gpt-4o")
        self.assertTrue(openai_model["is_configured"])
        
        anthropic_model = next(m for m in models if m["name"] == "anthropic:claude-3-5-sonnet-latest")
        self.assertFalse(anthropic_model["is_configured"])

    @patch("backend.cloud_providers.query_openai", new_callable=AsyncMock)
    @patch("backend.cloud_providers.query_anthropic", new_callable=AsyncMock)
    async def test_query_cloud_model_routing(self, mock_query_anthropic, mock_query_openai):
        messages = [{"role": "user", "content": "hello"}]
        
        # Route openai:
        await cloud_providers.query_cloud_model("openai:gpt-4o", messages)
        mock_query_openai.assert_called_once_with("gpt-4o", messages, 120.0)
        
        # Route anthropic:
        await cloud_providers.query_cloud_model("anthropic:claude-3-5-sonnet-latest", messages)
        mock_query_anthropic.assert_called_once_with("claude-3-5-sonnet-latest", messages, 120.0)
