# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PM, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer at the address listed in the git commit history with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

You should receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

PM is a plugin that reads and writes files in a local repository. Security concerns most likely involve:

- Unintended file access outside the project directory
- Script injection through ingested content
- Credential exposure through knowledge base artifacts

## Supported Versions

Only the latest release is supported with security updates.
