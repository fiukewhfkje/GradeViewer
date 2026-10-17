// This small permission boundary is installed once by the repository owner.
// Runtime update logic can evolve only after the installed verifier accepts a release.
export const workflow = `name: Update GradeViewer
on:
  schedule:
    - cron: '0 0 * * *'
      timezone: America/New_York
  push:
    paths: ['.github/workflows/gradeviewer-update.yml']
  workflow_dispatch:
    inputs:
      version:
        description: 'Optional verified version, including an earlier version for rollback.'
        required: false
      channel:
        description: 'Optional: stable or preview. Saved for this installation only.'
        required: false
permissions:
  contents: write
  checks: read
concurrency:
  group: gradeviewer-update
  cancel-in-progress: false
jobs:
  update:
    if: github.repository != 'fiukewhfkje/GradeViewer'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.repository.default_branch }}
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Verify release and push to this installation
        env:
          REQUESTED_VERSION: \${{ inputs.version }}
          REQUESTED_CHANNEL: \${{ inputs.channel }}
          GH_TOKEN: \${{ github.token }}
        run: |
          if [ -f package.json ]; then cd .; else cd web; fi
          node scripts/update.mjs "$REQUESTED_VERSION"
          node scripts/push-update.mjs
`;
