FROM node:22-slim

# System deps for git + python (needed by some repos' test suites)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 python3-pip python3-venv \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Working directory for repos
RUN mkdir -p /workspace /repos

WORKDIR /workspace

# Entrypoint: interactive shell
CMD ["/bin/bash"]
