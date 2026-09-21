# GitHub repository presentation

The README is prepared for the current unpublished distribution state. This document contains the separate GitHub metadata to apply when publishing. Editing the README does not update GitHub’s About, Releases, Packages or contributor sidebar.

## About

**Description**

> Local codebase intelligence for AI coding assistants: source graphs, focused context, architecture drift and evidence-linked code review.

**Website**

Leave the website field empty until the public website is deployed. Use its verified production URL afterward; do not use a localhost or invented domain.

**Topics**

```text
codebase-intelligence knowledge-graph developer-tools ai coding-assistant
code-review static-analysis architecture mcp typescript python uv
```

Use the gear icon next to About on the repository page to set these fields. Enable the Releases, Packages and Resources sidebar items where applicable. Their availability and counts are controlled by GitHub and published artifacts, not Markdown.

## First release

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for release gates and platform wheel builds. The current source version is 1.4.0; only publish a corresponding tag/release after qualifying its artifacts. Upload the actual supported platform wheels with clear installation instructions and known limitations. Do not label untested platforms as verified.

After publication, update the README distribution table and replace its two placeholder badge URLs with:

```text
https://img.shields.io/github/v/release/amirhamzakhan2001/fehm?style=flat-square
https://img.shields.io/github/downloads/amirhamzakhan2001/fehm/total?style=flat-square&label=release%20downloads
```

In an HTML image attribute, escape `&` as `&amp;`. Update the image alt text as well. Release downloads measure GitHub asset downloads, not unique users or PyPI installs. Update PyPI installation instructions only after the official package is published and installation is verified.

## Credits

The README acknowledges Claude and OpenAI Codex as development tools. GitHub’s contributor list depends on commit authorship; do not fabricate commits or accounts to populate it. Maintain original upstream copyright and license notices.

No release, package, push, website deployment or remote metadata change is performed by these documentation edits.
