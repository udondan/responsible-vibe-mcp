/**
 * E2E Tests for OpenCode Workflows Plugin
 *
 * Tests the plugin hooks and tool registration by directly invoking
 * the plugin factory function with mock PluginInput.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowsPlugin } from '../../src/plugin.js';
import type { PluginInput, Hooks, Part, UserMessage } from '../../src/types.js';

// Test utilities
function createTempDir(): string {
  const dir = path.join(
    tmpdir(),
    `opencode-plugin-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a mock PluginInput for testing
 */
function createMockPluginInput(directory: string): PluginInput {
  return {
    client: {
      app: {
        log: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown,
    project: { id: 'test-project', path: directory },
    directory,
    worktree: directory,
    serverUrl: new URL('http://localhost:4096'),
    $: {} as unknown,
  };
}

/**
 * Compute the deterministic conversation ID that ConversationManager generates.
 * In NODE_ENV=test: `${basename(dir)}-${cleanBranch}-p423k1`
 */
function computeConversationId(directory: string, gitBranch: string): string {
  const projectName = path.basename(directory) || 'unknown-project';
  const cleanBranch = gitBranch
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${projectName}-${cleanBranch}-p423k1`;
}

/**
 * Compute the plan file path that ConversationManager generates.
 * - main/master: development-plan.md
 * - other: development-plan-${sanitizedBranch}.md
 */
function computePlanFilePath(directory: string, gitBranch: string): string {
  const sanitizedBranch = gitBranch.replace(/[/\\]/g, '-');
  const planFileName =
    gitBranch === 'main' || gitBranch === 'master'
      ? 'development-plan.md'
      : `development-plan-${sanitizedBranch}.md`;
  return path.resolve(directory, '.vibe', planFileName);
}

/**
 * Setup a .vibe directory with workflow state for testing.
 * Uses the same directory structure as FileStorage:
 *   .vibe/conversations/{conversationId}/state.json
 *
 * Conversation IDs use the same deterministic scheme as ConversationManager.
 * Plan file paths use the same naming as core (development-plan-*.md).
 *
 * IMPORTANT: temp dirs have no .git, so ConversationManager will detect
 * branch as 'default'. Use gitBranch='default' to match what core detects.
 */
async function setupWorkflowState(
  directory: string,
  options: {
    workflowName?: string;
    currentPhase?: string;
    gitBranch?: string;
  } = {}
): Promise<{ planFilePath: string }> {
  const {
    workflowName = 'epcc',
    currentPhase = 'explore',
    gitBranch = 'default',
  } = options;

  const vibeDir = path.join(directory, '.vibe');

  // Use deterministic conversation ID matching ConversationManager's scheme
  const conversationId = computeConversationId(directory, gitBranch);

  // FileStorage expects: .vibe/conversations/{conversationId}/state.json
  const conversationDir = path.join(vibeDir, 'conversations', conversationId);
  fs.mkdirSync(conversationDir, { recursive: true });

  // Use core's plan file naming scheme
  const planFilePath = computePlanFilePath(directory, gitBranch);

  const conversationState = {
    conversationId,
    projectPath: directory,
    gitBranch,
    currentPhase,
    planFilePath,
    workflowName,
    requireReviewsBeforePhaseTransition: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save conversation state in the correct location
  const stateFilePath = path.join(conversationDir, 'state.json');
  fs.writeFileSync(stateFilePath, JSON.stringify(conversationState, null, 2));

  // Create a minimal plan file
  const planContent = `# Development Plan

## Goal
Test development plan

## Explore

### Tasks
- [ ] Research codebase
- [ ] Understand requirements

### Notes

## Plan

### Tasks
- [ ] Create design

## Code

### Tasks
- [ ] Implement features

## Key Decisions

### Decision: Test Decision (2024-01-01)
- **Rationale:** Testing
- **Alternatives considered:** None

## Notes
`;
  fs.writeFileSync(planFilePath, planContent);

  return { planFilePath };
}

describe('OpenCode Workflows Plugin E2E', () => {
  let testDir: string;
  let hooks: Hooks;
  let mockInput: PluginInput;

  beforeEach(async () => {
    testDir = createTempDir();
    mockInput = createMockPluginInput(testDir);
  });

  afterEach(() => {
    cleanupDir(testDir);
  });

  describe('Plugin Loading', () => {
    it('plugin loads and returns hooks object', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      expect(hooks).toBeDefined();
      expect(typeof hooks).toBe('object');
    });

    it('plugin registers all expected hooks', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      // Verify core hooks exist
      expect(hooks['chat.message']).toBeDefined();
      expect(typeof hooks['chat.message']).toBe('function');

      expect(hooks['tool.execute.before']).toBeDefined();
      expect(typeof hooks['tool.execute.before']).toBe('function');

      expect(hooks['experimental.session.compacting']).toBeDefined();
      expect(typeof hooks['experimental.session.compacting']).toBe('function');
    });

    it('plugin registers workflow tools', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      // Verify tool registrations
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!.start_development).toBeDefined();
      expect(hooks.tool!.proceed_to_phase).toBeDefined();
      expect(hooks.tool!.conduct_review).toBeDefined();
      expect(hooks.tool!.reset_development).toBeDefined();
      expect(hooks.tool!.setup_project_docs).toBeDefined();
    });

    it('tools have proper structure with description, args, and execute', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const startDevelopment = hooks.tool!.start_development;
      expect(startDevelopment.description).toBeDefined();
      expect(typeof startDevelopment.description).toBe('string');
      expect(startDevelopment.args).toBeDefined();
      expect(startDevelopment.execute).toBeDefined();
      expect(typeof startDevelopment.execute).toBe('function');
    });
  });

  describe('chat.message hook', () => {
    it('injects phase instructions when workflow is active', async () => {
      // Setup workflow state
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      // Create mock input/output for the hook
      const hookInput = {
        sessionID: 'test-session',
        messageID: 'msg-123',
      };

      const mockMessage: UserMessage = {
        id: 'msg-123',
        sessionID: 'test-session',
        role: 'user',
      };

      const output = {
        message: mockMessage,
        parts: [] as Part[],
      };

      // Call the hook
      await hooks['chat.message']!(hookInput, output);

      // Verify phase instructions were injected
      expect(output.parts.length).toBeGreaterThan(0);

      const injectedPart = output.parts[0];
      expect(injectedPart.type).toBe('text');
      expect(injectedPart.text).toContain('Explore');
    });

    it('marks injected phase instruction parts as synthetic to prevent undo restoring them', async () => {
      // Setup workflow state
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        sessionID: 'test-session',
        messageID: 'msg-123',
      };

      const mockMessage: UserMessage = {
        id: 'msg-123',
        sessionID: 'test-session',
        role: 'user',
      };

      const output = {
        message: mockMessage,
        parts: [] as Part[],
      };

      await hooks['chat.message']!(hookInput, output);

      // All injected parts must be synthetic so opencode's undo flow
      // (extractPromptFromParts) does not restore plugin instructions
      // as the user's message text.
      expect(output.parts.length).toBeGreaterThan(0);
      for (const part of output.parts) {
        expect((part as { synthetic?: boolean }).synthetic).toBe(true);
      }
    });

    it('injects start workflow prompt when no workflow is active', async () => {
      // No workflow setup - directory exists but no .vibe
      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        sessionID: 'test-session',
        messageID: 'msg-123',
      };

      const mockMessage: UserMessage = {
        id: 'msg-123',
        sessionID: 'test-session',
        role: 'user',
      };

      const output = {
        message: mockMessage,
        parts: [] as Part[],
      };

      await hooks['chat.message']!(hookInput, output);

      // Should inject a "start workflow" prompt
      expect(output.parts.length).toBe(1);
      const part = output.parts[0] as {
        type: string;
        text: string;
        synthetic?: boolean;
      };
      expect(part.type).toBe('text');
      expect(part.text).toContain('start_development');
      // Must be synthetic so undo doesn't restore it as the user's message
      expect(part.synthetic).toBe(true);
    });
  });

  describe('tool.execute.before hook', () => {
    it('blocks .ts file edits in explore phase', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'edit',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.ts',
          oldString: 'foo',
          newString: 'bar',
        },
      };

      // Should throw an error blocking the edit
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).rejects.toThrow('BLOCKED:');
    });

    it('allows .md file edits in explore phase', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'edit',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.md',
          oldString: 'foo',
          newString: 'bar',
        },
      };

      // Should NOT throw
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).resolves.not.toThrow();
    });

    it('allows all file edits in code phase', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'code',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'edit',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.ts',
          oldString: 'foo',
          newString: 'bar',
        },
      };

      // Should NOT throw in code phase
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).resolves.not.toThrow();
    });

    it('allows all edits when no workflow is active', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'edit',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.ts',
          oldString: 'foo',
          newString: 'bar',
        },
      };

      // Should NOT throw when no workflow is active
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).resolves.not.toThrow();
    });

    it('handles write tool same as edit tool', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'write',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.ts',
          content: 'new content',
        },
      };

      // Should throw for .ts file with write tool
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).rejects.toThrow('BLOCKED:');
    });

    it('ignores non-edit tools', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'read', // Not an edit tool
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: '/some/path/file.ts',
        },
      };

      // Should NOT throw for non-edit tools
      await expect(
        hooks['tool.execute.before']!(hookInput, output)
      ).resolves.not.toThrow();
    });
  });

  describe('experimental.session.compacting hook', () => {
    it('injects workflow context when active', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        sessionID: 'test-session',
      };

      const output = {
        context: [] as string[],
      };

      await hooks['experimental.session.compacting']!(hookInput, output);

      // Should have added minimal compaction guidance
      expect(output.context.length).toBeGreaterThan(0);
      // Check for the minimal guidance pattern
      expect(output.context.some(c => c.includes('Preserve'))).toBe(true);
      expect(output.context.some(c => c.includes('explore'))).toBe(true);
    });

    it('does not inject when no workflow is active', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        sessionID: 'test-session',
      };

      const output = {
        context: [] as string[],
      };

      await hooks['experimental.session.compacting']!(hookInput, output);

      // Should not have added anything
      expect(output.context.length).toBe(0);
    });
  });

  describe('start_development tool', () => {
    it('starts a new workflow', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.start_development.execute(
        { workflow: 'epcc' },
        {} as never
      );

      // start_development returns instructions from handler
      expect(result).toContain('plan file');

      // Verify state was created
      const vibeDir = path.join(testDir, '.vibe');
      expect(fs.existsSync(vibeDir)).toBe(true);
    });

    it('fails when workflow already active', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.start_development.execute(
        { workflow: 'waterfall' },
        {} as never
      );

      // When trying to start a different workflow, we get an error about existing workflow
      // OR if waterfall needs docs setup first, that error takes precedence
      // Note: "Missing docs" is the current message format (not "Documentation")
      expect(
        result.includes('already') || result.includes('Missing docs')
      ).toBe(true);
    });
  });

  describe('proceed_to_phase tool', () => {
    it('transitions to a valid phase', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.proceed_to_phase.execute(
        { target_phase: 'plan', reason: 'exploration complete' },
        {} as never
      );

      // Transition output now shows the new phase clearly
      expect(result).toContain('plan');
    });

    it('fails when no workflow is active', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.proceed_to_phase.execute(
        { target_phase: 'plan' },
        {} as never
      );

      // Error message from handler mentions "No development conversation" or similar
      expect(
        result.includes('No active workflow') ||
          result.includes('No development conversation')
      ).toBe(true);
    });
  });

  describe('reset_development tool', () => {
    it('requires confirmation', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.reset_development.execute(
        { confirm: false },
        {} as never
      );

      expect(result).toContain('confirm');
    });

    it('resets workflow when confirmed', async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: 'explore',
      });

      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.reset_development.execute(
        { confirm: true, reason: 'testing reset' },
        {} as never
      );

      // Reset message confirms deletion (may not include workflow name)
      expect(result).toContain('Reset');
    });

    it('handles no active workflow gracefully', async () => {
      hooks = await WorkflowsPlugin(mockInput);

      const result = await hooks.tool!.reset_development.execute(
        { confirm: true },
        {} as never
      );

      expect(result).toContain('No active workflow');
    });
  });
});

describe('File Pattern Restrictions', () => {
  let testDir: string;
  let hooks: Hooks;
  let mockInput: PluginInput;

  beforeEach(async () => {
    testDir = createTempDir();
    mockInput = createMockPluginInput(testDir);
  });

  afterEach(() => {
    cleanupDir(testDir);
  });

  const testCases = [
    // Explore phase - only docs/text (epcc.yaml: **/*.md, **/*.txt, **/*.adoc)
    { phase: 'explore', file: 'test.ts', shouldBlock: true },
    { phase: 'explore', file: 'test.tsx', shouldBlock: true },
    { phase: 'explore', file: 'test.js', shouldBlock: true },
    { phase: 'explore', file: 'test.jsx', shouldBlock: true },
    { phase: 'explore', file: 'test.py', shouldBlock: true },
    { phase: 'explore', file: 'test.md', shouldBlock: false },
    // yaml/json/toml are NOT in epcc explore patterns → blocked
    { phase: 'explore', file: 'test.yaml', shouldBlock: true },
    { phase: 'explore', file: 'test.json', shouldBlock: true },

    // Plan phase - same as explore (epcc.yaml: **/*.md, **/*.txt, **/*.adoc)
    { phase: 'plan', file: 'test.ts', shouldBlock: true },
    { phase: 'plan', file: 'test.md', shouldBlock: false },
    // toml is NOT in epcc plan patterns → blocked
    { phase: 'plan', file: 'test.toml', shouldBlock: true },

    // Code phase - all allowed (epcc.yaml: **/*)
    { phase: 'code', file: 'test.ts', shouldBlock: false },
    { phase: 'code', file: 'test.md', shouldBlock: false },

    // Red/green/refactor phases are NOT in epcc workflow → default **/* (unrestricted)
    { phase: 'red', file: 'test.test.ts', shouldBlock: false },
    { phase: 'red', file: 'test.spec.ts', shouldBlock: false },
    { phase: 'red', file: 'implementation.ts', shouldBlock: false },
    { phase: 'red', file: 'test.md', shouldBlock: false },

    // Green phase - not in epcc → default **/* (all allowed)
    { phase: 'green', file: 'test.ts', shouldBlock: false },

    // Refactor phase - not in epcc → default **/* (all allowed)
    { phase: 'refactor', file: 'test.ts', shouldBlock: false },
  ];

  for (const { phase, file, shouldBlock } of testCases) {
    it(`${shouldBlock ? 'blocks' : 'allows'} ${file} in ${phase} phase`, async () => {
      await setupWorkflowState(testDir, {
        workflowName: 'epcc',
        currentPhase: phase,
      });

      hooks = await WorkflowsPlugin(mockInput);

      const hookInput = {
        tool: 'edit',
        sessionID: 'test-session',
        callID: 'call-123',
      };

      const output = {
        args: {
          filePath: `/some/path/${file}`,
          oldString: 'foo',
          newString: 'bar',
        },
      };

      if (shouldBlock) {
        await expect(
          hooks['tool.execute.before']!(hookInput, output)
        ).rejects.toThrow('BLOCKED:');
      } else {
        await expect(
          hooks['tool.execute.before']!(hookInput, output)
        ).resolves.not.toThrow();
      }
    });
  }
});

describe('WORKFLOW_ACTIVE_AGENTS environment variable', () => {
  let dir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    dir = createTempDir();
    originalEnv = process.env.WORKFLOW_ACTIVE_AGENTS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WORKFLOW_ACTIVE_AGENTS;
    } else {
      process.env.WORKFLOW_ACTIVE_AGENTS = originalEnv;
    }
    cleanupDir(dir);
  });

  it('activates for all agents when WORKFLOW_ACTIVE_AGENTS is not set', async () => {
    delete process.env.WORKFLOW_ACTIVE_AGENTS;

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-1',
      role: 'user',
    };
    const output = { message: mockMessage, parts: [] as Part[] };

    // Any agent (including unlisted ones) should get instructions injected
    await hooks['chat.message']!(
      { sessionID: 'sess-1', agent: 'build' },
      output
    );
    expect(output.parts.length).toBeGreaterThan(0);
  });

  it('skips chat.message hook for agents not in the filter list', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-1',
      role: 'user',
    };
    const output = { message: mockMessage, parts: [] as Part[] };

    // 'build' is not in the active agents list → hook should skip
    await hooks['chat.message']!(
      { sessionID: 'sess-1', agent: 'build' },
      output
    );
    expect(output.parts.length).toBe(0);
  });

  it('injects instructions for agents that are in the filter list', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-1',
      role: 'user',
    };
    const output = { message: mockMessage, parts: [] as Part[] };

    // 'vibe' is in the active agents list → instructions should be injected
    await hooks['chat.message']!(
      { sessionID: 'sess-1', agent: 'vibe' },
      output
    );
    expect(output.parts.length).toBeGreaterThan(0);
  });

  it('is case-insensitive when matching agent names', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'Vibe';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-1',
      role: 'user',
    };
    const output = { message: mockMessage, parts: [] as Part[] };

    // 'VIBE' (uppercase from runtime) should match 'Vibe' in env var
    await hooks['chat.message']!(
      { sessionID: 'sess-1', agent: 'VIBE' },
      output
    );
    expect(output.parts.length).toBeGreaterThan(0);
  });

  it('supports multiple agents in comma-separated list', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe, dev, build';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    for (const agent of ['vibe', 'dev', 'build']) {
      const mockMessage: UserMessage = {
        id: `msg-${agent}`,
        sessionID: `sess-${agent}`,
        role: 'user',
      };
      const output = { message: mockMessage, parts: [] as Part[] };
      await hooks['chat.message']!(
        { sessionID: `sess-${agent}`, agent },
        output
      );
      expect(output.parts.length).toBeGreaterThan(0);
    }
  });

  it('throws agent-inactive error when tool is called by an inactive agent', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // 'build' is not in the active agents list
    await expect(
      hooks.tool!['start_development'].execute({ workflow: 'epcc' }, {
        agent: 'build',
        sessionID: 'sess-1',
      } as never)
    ).rejects.toThrow(/not active/i);
  });

  it('allows tool execution for agents in the filter list', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // 'vibe' is in the active agents list — should not throw the agent-inactive error
    let thrownMessage: string | undefined;
    try {
      await hooks.tool!['start_development'].execute({ workflow: 'epcc' }, {
        agent: 'vibe',
        sessionID: 'sess-1',
      } as never);
    } catch (err) {
      thrownMessage = (err as Error).message;
    }
    // If it threw, it must not be the agent-inactive error
    if (thrownMessage !== undefined) {
      expect(thrownMessage).not.toMatch(/not active/i);
    }
  });

  it('skips tool.execute.before for inactive agents (no file blocking)', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // First, register the agent via chat.message so sessionAgents is populated
    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-build',
      role: 'user',
    };
    await hooks['chat.message']!(
      { sessionID: 'sess-build', agent: 'build' },
      { message: mockMessage, parts: [] as Part[] }
    );

    // Now try an edit that would be blocked in explore phase — but agent is 'build' (inactive)
    // so the hook should skip and NOT throw
    await expect(
      hooks['tool.execute.before']!(
        { tool: 'edit', sessionID: 'sess-build', callID: 'call-1' },
        { args: { filePath: '/some/file.ts', oldString: 'a', newString: 'b' } }
      )
    ).resolves.not.toThrow();
  });

  it('injects system prompt suppression for inactive agents', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // Seed sessionAgents by firing chat.message for an inactive agent
    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-build',
      role: 'user',
    };
    await hooks['chat.message']!(
      { sessionID: 'sess-build', agent: 'build' },
      { message: mockMessage, parts: [] as Part[] }
    );

    const systemOutput = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']!(
      { sessionID: 'sess-build', model: { providerID: 'x', modelID: 'y' } },
      systemOutput
    );

    // Should inject a suppression instruction for the inactive agent
    expect(systemOutput.system.length).toBeGreaterThan(0);
    expect(systemOutput.system.some(s => s.includes('start_development'))).toBe(
      true
    );
  });

  it('does NOT inject system prompt suppression for active agents', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // Seed sessionAgents by firing chat.message for the active agent
    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-vibe',
      role: 'user',
    };
    await hooks['chat.message']!(
      { sessionID: 'sess-vibe', agent: 'vibe' },
      { message: mockMessage, parts: [] as Part[] }
    );

    const systemOutput = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']!(
      { sessionID: 'sess-vibe', model: { providerID: 'x', modelID: 'y' } },
      systemOutput
    );

    // Active agent should NOT get the suppression instruction
    expect(systemOutput.system.length).toBe(0);
  });

  it('/workflow off disables hooks even for agents in the active list', async () => {
    process.env.WORKFLOW_ACTIVE_AGENTS = 'vibe';

    await setupWorkflowState(dir, {
      workflowName: 'epcc',
      currentPhase: 'explore',
    });
    const hooks = await WorkflowsPlugin(createMockPluginInput(dir));

    // Disable via command
    await hooks['command.execute.before']!(
      { command: 'workflow', arguments: 'off', sessionID: 'sess-vibe' },
      { parts: [] as Part[] }
    );

    // Even 'vibe' (active agent) should now be skipped
    const mockMessage: UserMessage = {
      id: 'msg-1',
      sessionID: 'sess-vibe',
      role: 'user',
    };
    const output = { message: mockMessage, parts: [] as Part[] };
    await hooks['chat.message']!(
      { sessionID: 'sess-vibe', agent: 'vibe' },
      output
    );
    expect(output.parts.length).toBe(0);
  });
});
