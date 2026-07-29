# Resume Fill Agent fork

This directory contains a local fork of [Page Agent](https://github.com/alibaba/page-agent), used as the automation foundation for Resume Fill Agent.

## Local changes

- Removed the upstream Chrome manifest key so this fork builds with its own extension identity.
- Changed the default model configuration to the user's own DeepSeek-compatible endpoint.
- Added a local resume text setting and `.txt` resume import.
- Added instructions that allow form reading, clicking, selecting and typing, while prohibiting automatic submission and sensitive-value fabrication.

## Attribution and license

The upstream project is licensed under the MIT License. Its original `LICENSE` file and copyright notices are retained in this repository. This fork is not affiliated with Alibaba or the Page Agent project.
