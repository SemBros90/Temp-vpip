# Project Mind

Build a desktop-first application called "Vaigyanic Project Intelligence Platform (VPIP)".

CORE PURPOSE

VPIP is not a chatbot, not a note-taking application, and not a project management tool.

VPIP is a Project Intelligence Platform where users can discuss projects with multiple AI providers, preserve all discussions permanently, extract structured knowledge from discussions, generate documents, generate prompts, and continue discussions using historical project knowledge.

The project owns the memory.

AI providers are interchangeable reasoning engines.

Knowledge must remain available even when switching AI providers.

TECH STACK

Frontend:

- React

- TypeScript

- Vite

Desktop:

- Electron

Storage:

- Local file system only

- No cloud dependency

- No mandatory database

File Formats:

- Markdown (.md) for discussions, documents, prompts, decisions, requirements

- JSON (.json) for metadata, indexes, settings

AI Providers V1:

- OpenAI

- DeepSeek

APPLICATION STRUCTURE

The application must support multiple projects.

Each project contains multiple discussions.

Example:

Project: Vaigyanic

- CAD Architecture

- DFM Rules

- CAM Planning

- Raspberry Pi Automation

- Prompt Engineering

- Business Model

- Research Notes

Never use one giant discussion timeline.

PROJECT FOLDER STRUCTURE

Projects

 └── ProjectName

      ├── Discussions

      ├── KnowledgeInbox

      ├── Decisions

      ├── Requirements

      ├── Ideas

      ├── Risks

      ├── Questions

      ├── Documents

      ├── Prompts

      ├── Attachments

      ├── Snapshots

      └── project.json

MODULE 1 – PROJECT MANAGEMENT

Features:

- Create Project

- Open Project

- Rename Project

- Archive Project

- Delete Project

- Project Dashboard

Project Dashboard must display:

- Project Name

- Total Discussions

- Total Decisions

- Total Requirements

- Total Risks

- Total Questions

- Total Prompts

- Total Documents

- Connected AI Providers

- Last Activity

MODULE 2 – AI PROVIDER MANAGEMENT

Support:

- OpenAI

- DeepSeek

Features:

- API Key Storage

- Model Selection

- Provider Switching

- Provider Configuration

- Connection Testing

- Provider Status

ARCHITECTURE RULE

Project memory belongs to the project.

When switching between OpenAI and DeepSeek, all discussions, decisions, requirements, prompts and documents remain available.

MODULE 3 – DISCUSSION WORKSPACE

Discussion Types:

- General

- Requirement

- Architecture

- Decision

- Research

- Risk

- Prompt

- Business

- Other

Features:

- Create Discussion

- Continue Discussion

- Discussion Search

- Discussion History

- Discussion Summary

- Attach Files

- Attach PDFs

- Attach Images

- Export Discussion

Every message must be automatically saved.

Save:

- User messages

- AI messages

- Attachments

- Timestamps

- AI provider used

MODULE 4 – MEMORY ENGINE

Features:

- Real-Time Save

- Auto Save

- Manual Save

- Project Backup

- Discussion Backup

- Snapshot Creation

All project data must be stored locally.

Human-readable storage only.

MODULE 5 – KNOWLEDGE EXTRACTION ENGINE

After every discussion or on user request, AI analyzes content and extracts:

- Decision

- Requirement

- Idea

- Risk

- Question

- Assumption

Do not automatically approve extracted knowledge.

MODULE 6 – KNOWLEDGE INBOX

All extracted knowledge first enters Knowledge Inbox.

Knowledge Inbox items include:

- Decision Candidate

- Requirement Candidate

- Idea Candidate

- Risk Candidate

- Question Candidate

User Actions:

- Approve

- Reject

- Edit

- Merge

Only approved items become official project knowledge.

MODULE 7 – MASTER REGISTER

Create a permanent project register.

Sections:

- Decisions

- Requirements

- Ideas

- Risks

- Questions

- Prompts

- Documents

This is the project's single source of truth.

MODULE 8 – KNOWLEDGE EXPLORER

Views:

- All Knowledge

- Decisions

- Requirements

- Ideas

- Risks

- Questions

- Prompts

- Documents

Features:

- Search

- Filter

- Sort

- Open Source Discussion

- Open Related Knowledge

MODULE 9 – CONTEXT RETRIEVAL ENGINE

When user asks:

"What did we decide about Raspberry Pi?"

System must:

- Search Discussions

- Search Decisions

- Search Requirements

- Search Documents

- Search Prompts

- Build Context Package

- Send Context To Selected AI

- Return answer with references

The AI must answer using project knowledge, not only current chat context.

MODULE 10 – DOCUMENT GENERATOR

Generate:

- Project Summary

- Decision Register

- Requirement Register

- Architecture Summary

- Discussion Summary

- Research Summary

- Project Knowledge Book

Store generated documents permanently inside project folders.

MODULE 11 – PROMPT GENERATOR

Generate:

- Lovable Prompt

- Replit Prompt

- Architecture Prompt

- Research Prompt

- Business Prompt

- Custom Prompt

Generated prompts must be stored as project assets.

PROMPT STORAGE

Prompts

- Lovable Prompt V1

- Lovable Prompt V2

- Replit Prompt V1

- Research Prompt

- Architecture Prompt

TRACEABILITY SYSTEM

Every knowledge object must contain:

- Object ID

- Title

- Description

- Source Discussion

- Source Messages

- AI Provider

- Author

- Creation Date

- Revision History

Example:

Decision D-001

Source:

Architecture Discussion

Messages:

125-132

Provider:

OpenAI

Date:

2026-09-21

User must always be able to trace why a decision was made.

SNAPSHOT SYSTEM

Whenever user generates:

- PRD

- Architecture Document

- Summary

- Prompt

- Research Report

Create a snapshot.

Store snapshots permanently.

SETTINGS

AI Settings:

- OpenAI API Key

- DeepSeek API Key

- Default Provider

- Default Model

Storage Settings:

- Project Root Folder

- Backup Folder

- Auto Save Interval

USER EXPERIENCE REQUIREMENTS

- Desktop-first

- Modern professional UI

- Fast navigation

- Local-first architecture

- Human-readable files

- No cloud dependency

- No hidden storage

- User owns all project data

- AI providers interchangeable

- Permanent project memory

- Clean sidebar navigation

- Project-centric workflow

V1 SUCCESS CRITERIA

User can:

- Create Projects

- Create Multiple Discussions

- Connect OpenAI

- Connect DeepSeek

- Discuss Ideas

- Switch AI Providers

- Store Everything Locally

- Search Historical Discussions

- Approve Knowledge Items

- Maintain Master Register

- Generate Documents

- Generate Prompts

- Retrieve Historical Decisions

- Continue Discussions Using Historical Context

FINAL DESIGN PRINCIPLE

Discussion creates knowledge.

Knowledge creates decisions.

Decisions create documents.

Documents create prompts.

The project owns the memory.

AI provides reasoning.

All project knowledge remains available forever regardless of which AI provider is selected.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cec303a9-094e-4c8a-8536-04a7ebe40f7d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
