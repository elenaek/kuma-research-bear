/**
 * PromptBuilder - Fluent API for constructing system prompts
 *
 * Usage:
 * ```
 * const prompt = new PromptBuilder()
 *   .withRole('researchAssistant')
 *   .withTask('Explain complex academic papers')
 *   .withPersona('professional')
 *   .withPurpose('learning')
 *   .withVerbosity(3)
 *   .withLatexSupport()
 *   .withLanguage('en')
 *   .build();
 * ```
 */

import type { RoleType, PromptLanguage, BuiltPrompt, PromptComponent } from './types';
import type { Persona, Purpose } from '../types/personaPurpose';
import { ROLES, ANALYZER_ROLES, UTILITY_ROLES } from './components/roles.ts';
import {
  LATEX_RULES,
  MARKDOWN_FORMATTING,
  MARKDOWN_FORMATTING_DETAILED,
  JSON_FORMAT_REMINDER,
} from './components/formatting.ts';
import { getLanguageInstruction, getGlossaryLanguageInstruction } from './components/language.ts';
import { getPersonaInstruction, getPersonaTokenCount } from './components/personas.ts';
import { getPurposeInstruction, getPurposeTokenCount } from './components/purposes.ts';
import { getVerbosityInstruction, getVerbosityTokenCount } from './components/verbosity.ts';

export class PromptBuilder {
  private components: Array<{ name: string; component: PromptComponent }> = [];
  private role: string | null = null;
  private task: string | null = null;
  private outputFormat: string | null = null;
  private contextVariables: Record<string, string> = {};

  /**
   * Set the role for the AI
   * @param roleType - Standard role type or custom role string
   */
  withRole(roleType: RoleType | string, variant?: keyof typeof ANALYZER_ROLES | keyof typeof UTILITY_ROLES): this {
    if (typeof roleType === 'string' && roleType in ROLES) {
      this.role = ROLES[roleType as RoleType].content;
      this.components.push({
        name: 'role',
        component: ROLES[roleType as RoleType],
      });
    } else if (variant && variant in ANALYZER_ROLES) {
      this.role = ANALYZER_ROLES[variant].content;
      this.components.push({
        name: 'role',
        component: ANALYZER_ROLES[variant],
      });
    } else if (variant && variant in UTILITY_ROLES) {
      this.role = UTILITY_ROLES[variant].content;
      this.components.push({
        name: 'role',
        component: UTILITY_ROLES[variant],
      });
    } else {
      // Custom role string
      this.role = roleType as string;
      this.components.push({
        name: 'role',
        component: { content: roleType as string, tokens: 10 },
      });
    }
    return this;
  }

  /**
   * Set the task/goal for the AI
   */
  withTask(task: string): this {
    this.task = task;
    this.components.push({
      name: 'task',
      component: { content: task, tokens: Math.ceil(task.split(' ').length * 1.3) },
    });
    return this;
  }

  /**
   * Add LaTeX support instructions
   */
  withLatexSupport(): this {
    this.components.push({
      name: 'latex',
      component: LATEX_RULES,
    });
    return this;
  }

  /**
   * Add markdown formatting instructions
   * @param detailed - Use detailed formatting instructions with examples
   */
  withMarkdownFormatting(detailed: boolean = false): this {
    this.components.push({
      name: 'markdown',
      component: detailed ? MARKDOWN_FORMATTING_DETAILED : MARKDOWN_FORMATTING,
    });
    return this;
  }

  /**
   * Add JSON format reminder (for structured outputs)
   */
  withJsonFormatReminder(): this {
    this.components.push({
      name: 'json-reminder',
      component: JSON_FORMAT_REMINDER,
    });
    return this;
  }

  /**
   * Add language instruction
   * @param language - Target output language
   * @param variant - Instruction variant
   */
  withLanguage(
    language: PromptLanguage,
    variant: 'standard' | 'entire' | 'analysis' | 'keep-terms' = 'standard'
  ): this {
    this.components.push({
      name: 'language',
      component: getLanguageInstruction(language, variant),
    });
    return this;
  }

  /**
   * Add glossary-specific language instruction
   */
  withGlossaryLanguage(language: PromptLanguage): this {
    this.components.push({
      name: 'glossary-language',
      component: getGlossaryLanguageInstruction(language),
    });
    return this;
  }

  /**
   * Add persona-based tone and communication style
   * @param persona - User persona (professional or student)
   */
  withPersona(persona: Persona): this {
    this.components.push({
      name: 'persona',
      component: {
        content: getPersonaInstruction(persona),
        tokens: getPersonaTokenCount(),
      },
    });
    return this;
  }

  /**
   * Add purpose-based focus and approach
   * @param purpose - User purpose (writing or learning)
   */
  withPurpose(purpose: Purpose): this {
    this.components.push({
      name: 'purpose',
      component: {
        content: getPurposeInstruction(purpose),
        tokens: getPurposeTokenCount(),
      },
    });
    return this;
  }

  /**
   * Add verbosity level for response length control
   * @param level - Verbosity level (1-5, where 1 is concise and 5 is detailed)
   */
  withVerbosity(level: number = 3): this {
    this.components.push({
      name: 'verbosity',
      component: {
        content: getVerbosityInstruction(level),
        tokens: getVerbosityTokenCount(),
      },
    });
    return this;
  }

  /**
   * Set output format instructions
   */
  withOutputFormat(format: string): this {
    this.outputFormat = format;
    this.components.push({
      name: 'output-format',
      component: { content: format, tokens: Math.ceil(format.split(' ').length * 1.3) },
    });
    return this;
  }

  /**
   * Add custom instruction
   */
  withCustomInstruction(name: string, instruction: string, tokens?: number): this {
    this.components.push({
      name: `custom-${name}`,
      component: {
        content: instruction,
        tokens: tokens || Math.ceil(instruction.split(' ').length * 1.3),
      },
    });
    return this;
  }

  /**
   * Set context variables (for template substitution)
   */
  withContext(key: string, value: string): this {
    this.contextVariables[key] = value;
    return this;
  }

  /**
   * Add multiple context variables at once
   */
  withContextBatch(context: Record<string, string>): this {
    this.contextVariables = { ...this.contextVariables, ...context };
    return this;
  }

  /**
   * Build the final prompt
   */
  build(): BuiltPrompt {
    const parts: string[] = [];
    let totalTokens = 0;
    const componentNames: string[] = [];

    // Add components in order
    for (const { name, component } of this.components) {
      parts.push(component.content);
      totalTokens += component.tokens || 0;
      componentNames.push(name);
    }

    // Join all parts with newlines
    let content = parts.join('\n');

    // Replace context variables
    for (const [key, value] of Object.entries(this.contextVariables)) {
      content = content.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    return {
      content,
      estimatedTokens: totalTokens,
      components: componentNames,
    };
  }

  /**
   * Build and return just the content string
   */
  buildString(): string {
    return this.build().content;
  }

  /**
   * Reset the builder to start fresh
   */
  reset(): this {
    this.components = [];
    this.role = null;
    this.task = null;
    this.outputFormat = null;
    this.contextVariables = {};
    return this;
  }
}
