---
name: data-scraper-agent
description: Build a fully automated AI-powered data collection agent for any public source — job boards, prices,
  news, GitHub, sports, anything. Runs on a schedule, enriches data with a free LLM (Gemini Flash), stores results
  in Notion/Sheets/Supabase, and learns from user feedback. Runs 100% free on GitHub Actions. Use when the user
  wants to monitor, collect, or track any public data automatically.
category: data
sources:
- repository: ecc
  original_path: skills/data-scraper-agent/SKILL.md
  sha256: 662e884d58f4089bd8e090ef8d32042b85a5d9b4715906a89072002704451c0a
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Data Scraper Agent

Build a fully automated AI-powered data collection agent for any public source — job boards, prices, news, GitHub, sports, anything. Runs on a schedule, enriches data with a free LLM (Gemini Flash), stores results in Notion/Sheets/Supabase, and learns from user feedback. Runs 100% free on GitHub Actions. Use when the user wants to monitor, collect, or track any public data automatically.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Data Scraper Agent; When to Activate; Core Concepts; The Three Layers; Free Stack; AI Model Fallback Chain; Batch API Calls for Efficiency; BAD: 33 API calls for 33 items; GOOD: 7 API calls for 33 items (batch size 5); Untrusted Scraped Data; Workflow; Step 1: Understand the Goal; Step 2: Design the Collection Architecture; Step 3: Build the Source Connector.

## Source provenance

- `ecc/skills/data-scraper-agent/SKILL.md`
