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

    @patch("httpx.AsyncClient.get")
    async def test_verify_key_and_fetch_models_openai(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "gpt-4o"},
                {"id": "gpt-4o-mini"},
                {"id": "text-embedding-3-small"},
                {"id": "o1-mini"},
            ]
        }
        mock_get.return_value = mock_resp
        
        models = await cloud_providers.verify_key_and_fetch_models("openai", "valid-key")
        self.assertEqual(models, ["openai:gpt-4o", "openai:gpt-4o-mini", "openai:o1-mini"])
        mock_get.assert_called_once_with("https://api.openai.com/v1/models", headers={"Authorization": "Bearer valid-key"})

    @patch("httpx.AsyncClient.get")
    async def test_verify_key_and_fetch_models_anthropic(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "claude-3-5-sonnet-20241022"},
                {"id": "claude-3-5-haiku-20241022"},
            ]
        }
        mock_get.return_value = mock_resp
        
        models = await cloud_providers.verify_key_and_fetch_models("anthropic", "valid-key")
        self.assertEqual(models, ["anthropic:claude-3-5-haiku-20241022", "anthropic:claude-3-5-sonnet-20241022"])
        mock_get.assert_called_once_with(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": "valid-key", "anthropic-version": "2023-06-01"}
        )

    @patch("httpx.AsyncClient.get")
    async def test_verify_key_and_fetch_models_gemini(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [
                {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
            ]
        }
        mock_get.return_value = mock_resp
        
        models = await cloud_providers.verify_key_and_fetch_models("gemini", "valid-key")
        self.assertEqual(models, ["gemini:gemini-2.5-flash", "gemini:gemini-2.5-pro"])
        mock_get.assert_called_once_with(
            "https://generativelanguage.googleapis.com/v1beta/models",
            headers={"x-goog-api-key": "valid-key"}
        )

    @patch("httpx.AsyncClient.get")
    async def test_verify_key_and_fetch_models_deepseek(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "deepseek-chat"},
                {"id": "deepseek-reasoner"},
            ]
        }
        mock_get.return_value = mock_resp
        
        models = await cloud_providers.verify_key_and_fetch_models("deepseek", "valid-key")
        self.assertEqual(models, ["deepseek:deepseek-chat", "deepseek:deepseek-reasoner"])
        mock_get.assert_called_once_with(
            "https://api.deepseek.com/models",
            headers={"Authorization": "Bearer valid-key"}
        )

    @patch("httpx.AsyncClient.get")
    async def test_verify_key_and_fetch_models_openrouter(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "google/gemini-2.5-pro"},
                {"id": "openai/gpt-4o"},
                {"id": "openai/text-embedding-3"},
            ]
        }
        mock_get.return_value = mock_resp
        
        models = await cloud_providers.verify_key_and_fetch_models("openrouter", "valid-key")
        self.assertEqual(models, ["openrouter:google/gemini-2.5-pro", "openrouter:openai/gpt-4o"])
        mock_get.assert_called_once_with(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": "Bearer valid-key"}
        )
