import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from backend import council


class QueryAnyModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_openrouter_ids_are_not_routed_to_ollama(self):
        messages = [{"role": "user", "content": "hi"}]

        with (
            patch("backend.models_manager.list_local_models", new=AsyncMock(return_value=[{"name": "llama3.1:latest"}])),
            patch("backend.council.query_model", new=AsyncMock(return_value={"content": "remote"})) as mock_query_model,
            patch("backend.council.query_ollama", new=AsyncMock(return_value={"content": "local"})) as mock_query_ollama,
        ):
            result = await council.query_any_model("deepseek/deepseek-r1:free", messages)

        self.assertEqual(result["content"], "remote")
        mock_query_model.assert_awaited_once_with("deepseek/deepseek-r1:free", messages, timeout=600.0)
        mock_query_ollama.assert_not_awaited()

    async def test_local_model_base_name_resolves_latest_tag(self):
        messages = [{"role": "user", "content": "hi"}]

        with (
            patch("backend.models_manager.list_local_models", new=AsyncMock(return_value=[{"name": "llama3.1:latest"}])),
            patch("backend.council.query_model", new=AsyncMock(return_value={"content": "remote"})) as mock_query_model,
            patch("backend.council.query_ollama", new=AsyncMock(return_value={"content": "local"})) as mock_query_ollama,
        ):
            result = await council.query_any_model("llama3.1", messages)

        self.assertEqual(result["content"], "local")
        mock_query_ollama.assert_awaited_once_with("llama3.1:latest", messages, timeout=600.0)
        mock_query_model.assert_not_awaited()

    async def test_missing_local_tagged_model_returns_none_without_fallback(self):
        messages = [{"role": "user", "content": "hi"}]

        with (
            patch("backend.models_manager.list_local_models", new=AsyncMock(return_value=[{"name": "llama3.1:latest"}])),
            patch("backend.council.query_ollama", new=AsyncMock(return_value={"content": "local"})) as mock_query_ollama,
        ):
            result = await council.query_any_model("deepseek-r1:14b", messages)

        self.assertIsNone(result)
        mock_query_ollama.assert_not_awaited()

    async def test_parallel_queries_skip_models_that_timeout(self):
        messages = [{"role": "user", "content": "hi"}]

        async def fake_query_any_model(model, _messages, timeout=600.0):
            if model == "fast":
                return {"content": "fast"}
            await asyncio.sleep(0.05)
            return {"content": "slow"}

        with patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_query_any_model)):
            result = await council.query_models_parallel_any(
                ["fast", "slow"],
                messages,
                timeout=0.01,
            )

        self.assertEqual(result["fast"]["content"], "fast")
        self.assertIsNone(result["slow"])


class StageFlowTests(unittest.IsolatedAsyncioTestCase):
    def test_auto_profile_detects_strategy_queries(self):
        self.assertEqual(
            council.resolve_synthesis_profile(
                "Marketing strategy for Sift personalised news app",
                "auto",
            ),
            "strategic",
        )

    def test_auto_profile_defaults_to_concise_for_normal_queries(self):
        self.assertEqual(
            council.resolve_synthesis_profile(
                "What is the capital of France?",
                "auto",
            ),
            "concise",
        )

    async def test_stage1_collect_responses_uses_per_model_routing(self):
        async def fake_query_any_model(model, messages, timeout=600.0):
            return {"content": f"reply:{model}"}

        with (
            patch("backend.council.query_models_parallel", new=AsyncMock(side_effect=AssertionError("unexpected bulk OpenRouter call"))),
            patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_query_any_model)),
        ):
            result = await council.stage1_collect_responses(
                "question",
                models_override=["llama3.1:latest", "openai/gpt-4o-mini"],
            )

        self.assertEqual(
            result,
            [
                {"model": "llama3.1:latest", "response": "reply:llama3.1:latest"},
                {"model": "openai/gpt-4o-mini", "response": "reply:openai/gpt-4o-mini"},
            ],
        )

    async def test_stage2_recovers_ranking_when_model_ignores_format(self):
        stage1_results = [
            {"model": "alpha", "response": "Alpha answer"},
            {"model": "beta", "response": "Beta answer"},
        ]

        initial_responses = {
            "deepseek-coder:latest": {"content": "I cannot rank these in the exact format requested."},
            "deepseek-r1:latest": {"content": "FINAL RANKING:\n1. Response B\n2. Response A"},
        }

        async def fake_recovery(model, messages, timeout=600.0):
            if model == "deepseek-coder:latest":
                return {"content": "FINAL RANKING:\n1. Response A\n2. Response B"}
            return None

        with (
            patch("backend.council.query_models_parallel_any", new=AsyncMock(return_value=initial_responses)),
            patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_recovery)),
        ):
            stage2_results, _ = await council.stage2_collect_rankings(
                "question",
                stage1_results,
                models_override=["deepseek-coder:latest", "deepseek-r1:latest"],
            )

        recovered = next(item for item in stage2_results if item["model"] == "deepseek-coder:latest")
        self.assertEqual(recovered["parsed_ranking"], ["Response A", "Response B"])
        self.assertTrue(recovered["ranking_recovered"])

    async def test_stage3_falls_back_to_top_ranked_stage1_response(self):
        stage1_results = [
            {"model": "alpha", "response": "Alpha answer"},
            {"model": "beta", "response": "Beta answer"},
        ]
        stage2_results = [
            {
                "model": "judge-1",
                "ranking": "FINAL RANKING:\n1. Response B\n2. Response A",
                "parsed_ranking": ["Response B", "Response A"],
            },
            {
                "model": "judge-2",
                "ranking": "FINAL RANKING:\n1. Response B\n2. Response A",
                "parsed_ranking": ["Response B", "Response A"],
            },
        ]

        with patch("backend.council.query_any_model", new=AsyncMock(return_value=None)):
            result = await council.stage3_synthesize_final(
                "question",
                stage1_results,
                stage2_results,
                chairman_override="deepseek-r1:14b",
            )

        self.assertEqual(result["model"], "beta")
        self.assertEqual(result["response"], "Beta answer")
        self.assertIn("fallback", result)

    async def test_stage3_uses_actual_model_when_requested_chairman_falls_back(self):
        with patch(
            "backend.council.query_any_model",
            new=AsyncMock(
                return_value={
                    "model": "llama3.1:latest",
                    "requested_model": "deepseek-r1:14b",
                    "content": "Synthesized answer",
                }
            ),
        ):
            result = await council.stage3_synthesize_final(
                "question",
                [{"model": "alpha", "response": "Alpha answer"}],
                [],
                chairman_override="deepseek-r1:14b",
            )

        self.assertEqual(result["model"], "llama3.1:latest")
        self.assertEqual(result["requested_model"], "deepseek-r1:14b")

    async def test_stage3_prompt_discourages_glued_output(self):
        captured = {}

        async def fake_query_any_model(model, messages, timeout=600.0):
            captured["prompt"] = messages[0]["content"]
            return {"model": model, "content": "done"}

        with patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_query_any_model)):
            await council.stage3_synthesize_final(
                "question",
                [
                    {"model": "alpha", "response": "Alpha answer"},
                    {"model": "beta", "response": "Beta answer"},
                ],
                [],
                chairman_override="llama3.1:latest",
                synthesis_profile="concise",
            )

        self.assertIn("Do not concatenate", captured["prompt"])
        self.assertIn("Keep the answer concise", captured["prompt"])

    async def test_stage3_prompt_uses_compact_ranking_summary_not_full_reviews(self):
        captured = {}

        async def fake_query_any_model(model, messages, timeout=600.0):
            captured["prompt"] = messages[0]["content"]
            return {"model": model, "content": "done"}

        stage2_results = [
            {
                "model": "judge-1",
                "ranking": "Long evaluation text that should not be passed through verbatim.\nFINAL RANKING:\n1. Response B\n2. Response A",
                "parsed_ranking": ["Response B", "Response A"],
            }
        ]

        with patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_query_any_model)):
            await council.stage3_synthesize_final(
                "question",
                [
                    {"model": "alpha", "response": "Alpha answer"},
                    {"model": "beta", "response": "Beta answer"},
                ],
                stage2_results,
                chairman_override="llama3.1:latest",
                synthesis_profile="concise",
            )

        self.assertIn("Aggregate Ranking Signals", captured["prompt"])
        self.assertNotIn("Long evaluation text that should not be passed through verbatim.", captured["prompt"])

    def test_aggregate_rankings_skip_partial_rankings(self):
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        stage2_results = [
            {
                "model": "judge-1",
                "ranking": "FINAL RANKING:\n1. Response A",
                "parsed_ranking": ["Response A"],
            },
            {
                "model": "judge-2",
                "ranking": "FINAL RANKING:\n1. Response B\n2. Response A",
                "parsed_ranking": ["Response B", "Response A"],
            },
        ]

        aggregate = council.calculate_aggregate_rankings(stage2_results, label_to_model)

        self.assertEqual(
            aggregate,
            [
                {
                    "model": "beta",
                    "average_rank": 1.0,
                    "rankings_count": 1,
                },
                {
                    "model": "alpha",
                    "average_rank": 2.0,
                    "rankings_count": 1,
                },
            ],
        )

    async def test_stage3_strategic_profile_requests_steps_and_stages(self):
        captured = {}

        async def fake_query_any_model(model, messages, timeout=600.0):
            captured["prompt"] = messages[0]["content"]
            return {"model": model, "content": "done"}

        with patch("backend.council.query_any_model", new=AsyncMock(side_effect=fake_query_any_model)):
            await council.stage3_synthesize_final(
                "Marketing strategy for Sift personalised news app",
                [
                    {"model": "alpha", "response": "Alpha answer"},
                    {"model": "beta", "response": "Beta answer"},
                ],
                [],
                chairman_override="llama3.1:latest",
                synthesis_profile="strategic",
            )

        self.assertIn("Use sections and concrete next steps.", captured["prompt"])
        self.assertIn("Preserve useful stages", captured["prompt"])


class RankingParsingTests(unittest.TestCase):
    def test_parse_ranking_ignores_mentions_outside_ranking_section(self):
        ranking = (
            "Response A is detailed.\n"
            "Response B is concise.\n"
            "I prefer Response B overall, but Response A has better examples."
        )

        self.assertEqual(council.parse_ranking_from_text(ranking), [])
