"""3-stage LLM Council orchestration."""

import asyncio
import logging
import re
from typing import List, Dict, Any, Tuple
from .openrouter import query_models_parallel, query_model
from .ollama import query_ollama
import os

PARALLEL_STAGE_TIMEOUT_SECONDS = 90.0
CHAIRMAN_TIMEOUT_SECONDS = 180.0
RANKING_RECOVERY_TIMEOUT_SECONDS = 30.0
logger = logging.getLogger(__name__)


async def resolve_council_models(models_override: List[str] = None) -> List[str]:
    """Resolve which council models to use for a run."""
    if models_override:
        return models_override

    from . import models_manager

    local_models = await models_manager.list_local_models()
    return [model["name"] for model in local_models[:3]]


async def resolve_chairman_model(override: str = None) -> str:
    """Resolve which chairman model to use. Returns first local model if no override."""
    if override:
        return override

    from . import models_manager

    local_models = await models_manager.list_local_models()
    if local_models:
        return local_models[0]["name"]

    return "llama3.2"


def resolve_synthesis_profile(user_query: str, requested_profile: str = None) -> str:
    """Resolve the synthesis profile to use for the final answer."""
    normalized = (requested_profile or "auto").strip().lower()
    if normalized in {"concise", "strategic"}:
        return normalized

    strategy_patterns = [
        r"\bmarketing strategy\b",
        r"\bgo[- ]to[- ]market\b",
        r"\broadmap\b",
        r"\blaunch\b",
        r"\bpositioning\b",
        r"\bprivate beta\b",
        r"\btarget audience\b",
        r"\bgrowth\b",
        r"\bdistribution\b",
        r"\b90[- ]day\b",
        r"\bimplementation plan\b",
        r"\bplan\b",
        r"\bstages\b",
        r"\bsteps\b",
    ]
    lowered_query = user_query.lower()
    if any(re.search(pattern, lowered_query) for pattern in strategy_patterns):
        return "strategic"

    return "concise"


async def query_models_parallel_any(
    models: List[str],
    messages: List[Dict[str, str]],
    timeout: float = PARALLEL_STAGE_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    """Query a mixed set of local and remote models in parallel."""
    async def query_with_timeout(model: str):
        try:
            return await asyncio.wait_for(
                query_any_model(model, messages, timeout=timeout),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            print(f"Warning: Model {model} timed out after {timeout} seconds and will be skipped.")
            return None
        except Exception as exc:
            print(f"Warning: Model {model} failed during parallel query: {type(exc).__name__}: {exc}")
            return None

    tasks = [query_with_timeout(model) for model in models]
    responses = await asyncio.gather(*tasks)
    return {model: response for model, response in zip(models, responses)}


async def query_any_model(model: str, messages: List[Dict[str, str]], timeout: float = 600.0):
    """Query either cloud providers (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter) or Ollama based on model name."""
    from . import models_manager
    from . import cloud_providers

    async def with_metadata(resolved_model: str, awaited_result):
        response = await awaited_result
        if response is None:
            return None

        enriched = dict(response)
        enriched.setdefault("model", resolved_model)
        if resolved_model != model:
            enriched["requested_model"] = model
        return enriched

    if cloud_providers.is_cloud_model(model):
        return await with_metadata(model, cloud_providers.query_cloud_model(model, messages, timeout=timeout))

    local_models = await models_manager.list_local_models()
    installed_names = [entry["name"] for entry in local_models]

    if model in installed_names:
        return await with_metadata(model, query_ollama(model, messages, timeout=timeout))

    matching_installed = [name for name in installed_names if name.startswith(f"{model}:")]
    if matching_installed:
        target_model = next((name for name in matching_installed if name.endswith(":latest")), matching_installed[0])
        return await with_metadata(target_model, query_ollama(target_model, messages, timeout=timeout))

    if ":" in model:
        return None

    return await with_metadata(model, query_model(model, messages, timeout=timeout))


def build_label_to_model(stage1_results: List[Dict[str, Any]]) -> Dict[str, str]:
    """Create the anonymized label mapping for Stage 2."""
    return {
        f"Response {chr(65 + index)}": result["model"]
        for index, result in enumerate(stage1_results)
    }


def build_stage3_fallback(
    target_chairman: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]] = None,
    synthesis_profile: str = "concise",
) -> Dict[str, Any]:
    """Return the best available answer when chairman synthesis fails."""
    chosen_model = None

    if stage2_results:
        label_to_model = build_label_to_model(stage1_results)
        aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
        if aggregate_rankings:
            chosen_model = aggregate_rankings[0]["model"]

    chosen_stage1 = None
    if chosen_model:
        chosen_stage1 = next((result for result in stage1_results if result["model"] == chosen_model), None)

    if chosen_stage1 is None:
        chosen_stage1 = next((result for result in stage1_results if result.get("response")), None)

    if chosen_stage1 is None:
        return {
            "model": target_chairman,
            "response": "No council models produced a response.",
            "synthesis_profile": synthesis_profile,
            "fallback": {
                "requested_model": target_chairman,
                "reason": "chairman_unavailable",
            },
        }

    return {
        "model": chosen_stage1["model"],
        "response": chosen_stage1["response"],
        "synthesis_profile": synthesis_profile,
        "fallback": {
            "requested_model": target_chairman,
            "reason": "chairman_unavailable",
        },
    }


def build_stage2_signal_summary(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> str:
    """Compress peer ranking output into a compact signal summary for synthesis."""
    if not stage2_results:
        return ""

    lines = []
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
    if aggregate_rankings:
        lines.append("Aggregate Ranking Signals:")
        for index, item in enumerate(aggregate_rankings, start=1):
            lines.append(
                f"{index}. {item['model']} (average rank {item['average_rank']}, {item['rankings_count']} votes)"
            )

    per_model_lines = []
    for result in stage2_results:
        parsed_ranking = result.get("parsed_ranking") or parse_ranking_from_text(result.get("ranking", ""))
        if not result.get("ranking_complete"):
            continue
        if not parsed_ranking:
            continue

        resolved = [label_to_model[label] for label in parsed_ranking if label in label_to_model]
        if resolved:
            per_model_lines.append(f"{result['model']} ranked: {', '.join(resolved)}")

    if per_model_lines:
        if lines:
            lines.append("")
        lines.append("Peer Ranking Snapshots:")
        lines.extend(per_model_lines)

    return "\n".join(lines)


def build_stage3_prompt(
    user_query: str,
    stage1_text: str,
    stage2_text: str,
    stage2_results: List[Dict[str, Any]],
    synthesis_profile: str,
) -> str:
    """Build the chairman prompt for the selected synthesis profile."""
    profile_requirements = {
        "concise": [
            "Write one unified answer directly to the user.",
            "Do not concatenate, quote, or restate each model's answer one after another.",
            "Remove repetition and keep only the strongest points.",
            "If the models disagree, resolve the disagreement and explain the conclusion briefly.",
            "Keep the answer concise by default. Aim for about 200-350 words unless the user explicitly asked for depth.",
            "Lead with the direct answer or recommendation, then give the supporting reasoning.",
            "Do not mention the existence of stages, models, rankings, or the council process in the final answer.",
        ],
        "strategic": [
            "Write one unified answer directly to the user.",
            "Do not concatenate, quote, or restate each model's answer one after another.",
            "Preserve useful stages, steps, sequencing, and decision criteria when they help the answer.",
            "Use sections and concrete next steps.",
            "For strategy, planning, marketing, or product questions, prefer a practical memo over a short summary.",
            "Keep the answer informative, but still remove repetition and generic filler.",
            "Lead with the main recommendation, then cover rationale, staged plan, metrics, risks, and immediate next actions.",
            "Do not mention the existence of stages, models, rankings, or the council process in the final answer.",
        ],
    }
    requirements = "\n".join(f"- {item}" for item in profile_requirements[synthesis_profile])

    return f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question.
{ "Some models have also ranked each other's responses." if stage2_results else "" }

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- Any peer ranking signals provided
- Any patterns of agreement or disagreement

Requirements:
{requirements}

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""


def build_ranking_recovery_prompt(user_query: str, responses_text: str) -> str:
    """Build a strict fallback prompt when a model skipped the required ranking format."""
    return f"""You previously evaluated anonymized responses to a question but did not provide a usable final ranking.

Question: {user_query}

Responses:
{responses_text}

Return ONLY a final ranking in this exact format and nothing else:

FINAL RANKING:
1. Response X
2. Response Y

Rank every response from best to worst."""


async def recover_stage2_ranking(
    model: str,
    user_query: str,
    responses_text: str,
) -> Dict[str, Any] | None:
    """Ask a model for a strict ranking-only follow-up when parsing failed."""
    recovery_prompt = build_ranking_recovery_prompt(user_query, responses_text)
    response = await query_any_model(
        model,
        [{"role": "user", "content": recovery_prompt}],
        timeout=RANKING_RECOVERY_TIMEOUT_SECONDS,
    )
    if response is None:
        return None

    ranking_text = response.get("content", "")
    parsed_ranking = parse_ranking_from_text(ranking_text)
    if not parsed_ranking:
        return None

    return {
        "ranking": ranking_text,
        "parsed_ranking": parsed_ranking,
    }


async def stage1_collect_responses(user_query: str, models_override: List[str] = None) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.
    """
    target_models = await resolve_council_models(models_override)
    messages = [{"role": "user", "content": user_query}]

    # Query all models in parallel
    responses = await query_models_parallel_any(
        target_models,
        messages,
        timeout=PARALLEL_STAGE_TIMEOUT_SECONDS,
    )

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    models_override: List[str] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.
    """
    target_models = await resolve_council_models(models_override)
    label_to_model = build_label_to_model(stage1_results)

    if len(stage1_results) < 2:
        return [], label_to_model

    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.
3. Even if you are uncertain or cannot provide a full critique, you MUST still provide the FINAL RANKING block.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel_any(
        target_models,
        messages,
        timeout=PARALLEL_STAGE_TIMEOUT_SECONDS,
    )

    # Format results
    stage2_results = []
    recovery_jobs = []
    expected_labels = set(label_to_model)
    for model, response in responses.items():
        if response is None:
            continue

        full_text = response.get('content', '')
        parsed = parse_ranking_from_text(full_text)
        ranking_complete = is_complete_ranking(parsed, expected_labels)
        stage2_results.append({
            "model": model,
            "ranking": full_text,
            "parsed_ranking": parsed,
            "ranking_complete": ranking_complete,
            "ranking_recovered": False,
            "recovered_ranking_text": None,
        })

        if not ranking_complete:
            recovery_jobs.append(model)

    if recovery_jobs:
        recovered_rankings = await asyncio.gather(
            *(recover_stage2_ranking(model, user_query, responses_text) for model in recovery_jobs),
            return_exceptions=True,
        )
        recovered_by_model = {}
        for model, recovered in zip(recovery_jobs, recovered_rankings):
            if isinstance(recovered, Exception):
                recovered = None
            recovered_by_model[model] = recovered

        for result in stage2_results:
            recovered_ranking = recovered_by_model.get(result["model"])
            if recovered_ranking and is_complete_ranking(recovered_ranking["parsed_ranking"], expected_labels):
                result["parsed_ranking"] = recovered_ranking["parsed_ranking"]
                result["ranking_complete"] = True
                result["ranking_recovered"] = True
                result["recovered_ranking_text"] = recovered_ranking["ranking"]

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]] = None,
    chairman_override: str = None,
    synthesis_profile: str = "auto",
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.
    """
    resolved_profile = resolve_synthesis_profile(user_query, synthesis_profile)
    resolved_chairman = await resolve_chairman_model(chairman_override)
    if not stage1_results:
        return {
            "model": resolved_chairman,
            "response": "No council models produced a response.",
            "synthesis_profile": resolved_profile,
            "fallback": {
                "requested_model": resolved_chairman,
                "reason": "no_stage1_results",
            },
        }

    target_chairman = resolved_chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    label_to_model = build_label_to_model(stage1_results)
    stage2_text = ""
    if stage2_results:
        stage2_signal_summary = build_stage2_signal_summary(stage2_results, label_to_model)
        if stage2_signal_summary:
            stage2_text = "\n\nSTAGE 2 - Ranking Signals:\n" + stage2_signal_summary

    chairman_prompt = build_stage3_prompt(
        user_query,
        stage1_text,
        stage2_text,
        stage2_results,
        resolved_profile,
    )

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    response = await query_any_model(
        target_chairman,
        messages,
        timeout=CHAIRMAN_TIMEOUT_SECONDS,
    )

    if response is None or not response.get('content'):
        return build_stage3_fallback(target_chairman, stage1_results, stage2_results, resolved_profile)

    result = {
        "model": response.get("model", target_chairman),
        "response": response.get('content', ''),
        "reasoning": response.get('reasoning_details', ''),
        "synthesis_profile": resolved_profile,
    }
    if response.get("requested_model") and response["requested_model"] != result["model"]:
        result["requested_model"] = response["requested_model"]
    return result


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.
    """
    import re

    def dedupe(items: List[str]) -> List[str]:
        seen = set()
        ordered = []
        for item in items:
            if item not in seen:
                seen.add(item)
                ordered.append(item)
        return ordered

    def extract_ranking_lines(text: str) -> List[str]:
        labels = []
        for line in text.splitlines():
            stripped = line.strip()
            match = re.match(r'^\d+\.\s*(Response [A-Z])\s*$', stripped)
            if match:
                labels.append(match.group(1))
                continue

            match = re.match(r'^[-*]\s*(Response [A-Z])\s*$', stripped)
            if match:
                labels.append(match.group(1))
                continue

            match = re.match(r'^(Response [A-Z])\s*$', stripped)
            if match:
                labels.append(match.group(1))

        return dedupe(labels)

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        ranking_section = ranking_text.split("FINAL RANKING:", 1)[1]
        ranked_labels = extract_ranking_lines(ranking_section)
        if ranked_labels:
            return ranked_labels

        return dedupe(re.findall(r'\bResponse [A-Z]\b', ranking_section))

    return extract_ranking_lines(ranking_text)


def is_complete_ranking(parsed_ranking: List[str], expected_labels: set[str]) -> bool:
    """Return True when a parsed ranking matches the exact expected label set."""
    return len(parsed_ranking) == len(expected_labels) and set(parsed_ranking) == expected_labels


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)
    expected_labels = set(label_to_model)

    for ranking in stage2_results:
        parsed_ranking = ranking.get('parsed_ranking') or parse_ranking_from_text(ranking['ranking'])
        if not is_complete_ranking(parsed_ranking, expected_labels):
            continue

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.
    """
    # Quick fallback if query is very short
    if len(user_query) < 20:
        return user_query.strip()

    title_prompt = f"""Generate a very short title (3-5 words maximum) for this question. 
Return ONLY the title, no quotes or punctuation.

Question: {user_query[:500]}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use a local model for title generation
    title_model = await resolve_chairman_model()
    
    try:
        # Very short timeout for title to avoid blocking synthesis
        response = await query_any_model(title_model, messages, timeout=15.0)

        if response and response.get('content'):
            title = response.get('content').strip().strip('"\'')
            if title and len(title) < 60:
                return title
    except Exception:
        logger.exception("Failed to generate title")

    # Fallback: First 5 words
    words = user_query.split()
    fallback = " ".join(words[:5])
    return fallback + "..." if len(words) > 5 else fallback


async def run_full_council(
    user_query: str,
    council_models: List[str] = None,
    chairman_model: str = None,
    synthesis_profile: str = "auto",
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.
    """
    target_models = await resolve_council_models(council_models)

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, models_override=council_models)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {"failed_models": target_models}

    # Calculate Stage 1 failures
    responded_models = {res["model"] for res in stage1_results}
    failed_models = [m for m in target_models if m not in responded_models]

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results, models_override=council_models)

    # Calculate Stage 2 failures
    responded_ranking_models = {res["model"] for res in stage2_results}
    for m in target_models:
        if len(stage1_results) >= 2 and m not in responded_ranking_models and m not in failed_models:
            failed_models.append(m)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        chairman_override=chairman_model,
        synthesis_profile=synthesis_profile,
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "failed_models": failed_models
    }

    return stage1_results, stage2_results, stage3_result, metadata
