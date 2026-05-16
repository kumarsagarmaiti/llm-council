# Contributing

Thanks for your interest in improving `llm-council`.

## Project Posture

- Forks are encouraged.
- Pull requests are welcome.
- Reviews happen on a best-effort basis.
- There is no guaranteed support or merge timeline.

If you want full control over direction or velocity, forking is usually the fastest path.

## Before You Start

- Keep changes scoped and easy to review.
- Open an issue before starting major features or structural rewrites.
- Prefer small follow-up pull requests over one large omnibus change.

## Local Setup

Backend dependencies:

```bash
uv sync
```

Frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

Environment:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional local model support uses Ollama if you want to run chairman or local model workflows on your machine.

## Running The Project

Start both services:

```bash
./start.sh
```

Or run them separately:

```bash
uv run python -m backend.main
cd frontend
npm run dev
```

## Validation

Backend tests:

```bash
uv run python -m unittest discover tests
```

Frontend build:

```bash
cd frontend
npm run build
```

If your change affects behavior, include the validation you ran in the pull request description.

## Pull Request Guidelines

- Explain what changed and why.
- Mention any configuration assumptions.
- Call out follow-up work if the change is intentionally incomplete.
- Avoid unrelated cleanup in the same PR.

## Communication

Bug reports and focused fixes are the easiest contributions to act on.

For larger ideas, describe:

- the problem you are trying to solve
- the proposed approach
- why it belongs in this repo instead of a fork-specific customization
