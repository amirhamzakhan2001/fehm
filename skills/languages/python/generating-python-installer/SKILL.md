---
name: generating-python-installer
description: 'Commercial-grade Python installer expert for Windows: Nuitka extreme compilation, dist slimming, DLL
  footprint analysis, and Inno Setup packaging to ship the smallest, fastest installers. Use when a Python app must
  ship as a minimal, fast-starting Windows installer; not for basic script-to-exe conversion. 中文触发：Nuitka 极限优化、Python
  商业打包、极限编译 Python、dist 瘦身、DLL 分析、最小安装包、最快启动、商业级打包风格'
category: languages/python
sources:
- repository: ecc
  original_path: skills/generating-python-installer/SKILL.md
  sha256: 47e73ef601d900be3b5ccb5d1a1ba2371d3e46c67b5243c1810e51cd2d8f62f3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Generating Python Installer

Commercial-grade Python installer expert for Windows: Nuitka extreme compilation, dist slimming, DLL footprint analysis, and Inno Setup packaging to ship the smallest, fastest installers. Use when a Python app must ship as a minimal, fast-starting Windows installer; not for basic script-to-exe conversion. 中文触发：Nuitka 极限优化、Python 商业打包、极限编译 Python、dist 瘦身、DLL 分析、最小安装包、最快启动、商业级打包风格

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Generating Python Installer (Commercial-Grade); When to Activate; How It Works; Examples; 核心理念; 实战参考案例（生产级 PySide2 桌面应用，323 MB，含 OpenCV / Playwright）; 项目概况; 关键优化策略; 体积分布; 预期效果对比; 核心工作流 (Workflow) - WARNING: 严格执行; Nuitka 极限优化编译（基于 参考项目经验）; 一、32 位 vs 64 位选择策略; 1. 安装 32 位 Python（和 64 位可以共存）.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [memory/learn-ecc](../../../memory/learn-ecc/SKILL.md)

## Source provenance

- `ecc/skills/generating-python-installer/SKILL.md`
