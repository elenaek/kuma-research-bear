import { AICapabilities, AILanguageModelSession, AISessionOptions, ExplanationResult, SummaryResult, AIAvailability } from '../types/index.ts';

/**
 * Chrome AI Service for interacting with Chrome's built-in AI APIs
 * Uses the stable Prompt API (Chrome 138+)
 */
class ChromeAIService {
  private session: AILanguageModelSession | null = null;
  private capabilities: AICapabilities | null = null;

  /**
   * Check if Chrome Prompt API is available
   */
  async checkAvailability(): Promise<AICapabilities> {
    try {
      // Check if LanguageModel global is available
      if (typeof LanguageModel === 'undefined') {
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
        };
      }

      const availability: AIAvailability = await LanguageModel.availability();
      const params = await LanguageModel.params();

      this.capabilities = {
        available: availability === 'readily',
        availability,
        model: 'Gemini Nano',
        defaultTemperature: params.temperature.default,
        defaultTopK: params.topK.default,
        maxTopK: params.topK.max,
      };

      return this.capabilities;
    } catch (error) {
      console.error('Error checking AI availability:', error);
      return {
        available: false,
        availability: 'no',
        model: 'Gemini Nano',
      };
    }
  }

  /**
   * Create an AI session using the Prompt API
   */
  async createSession(options?: AISessionOptions): Promise<boolean> {
    try {
      if (typeof LanguageModel === 'undefined') {
        throw new Error('Prompt API not available');
      }

      this.session = await LanguageModel.create(options);

      return true;
    } catch (error) {
      console.error('Error creating AI session:', error);
      return false;
    }
  }

  /**
   * Prompt the AI model
   */
  async prompt(input: string, systemPrompt?: string): Promise<string> {
    try {
      if (!this.session) {
        const created = await this.createSession({ systemPrompt });
        if (!created) {
          throw new Error('Failed to create AI session');
        }
      }

      if (!this.session) {
        throw new Error('No active AI session');
      }

      const response = await this.session.prompt(input);
      return response;
    } catch (error) {
      console.error('Error prompting AI:', error);
      throw error;
    }
  }

  /**
   * Explain a research paper abstract
   */
  async explainAbstract(abstract: string): Promise<ExplanationResult> {
    const systemPrompt = `You are a helpful research assistant that explains complex academic papers in simple terms.
Your goal is to make research papers accessible to people without specialized knowledge.
Break down technical jargon, use analogies when helpful, and focus on the key insights.`;

    const input = `Please explain this research paper abstract in simple terms that anyone can understand:\n\n${abstract}`;

    const explanation = await this.prompt(input, systemPrompt);

    return {
      originalText: abstract,
      explanation,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate a summary of a paper
   */
  async generateSummary(title: string, abstract: string): Promise<SummaryResult> {
    const systemPrompt = `You are a research assistant that creates concise summaries of academic papers.
Extract the most important information and present it clearly.`;

    const input = `Create a brief summary and list 3-5 key points from this paper:

Title: ${title}

Abstract: ${abstract}

Format your response as:
SUMMARY: [2-3 sentence summary]
KEY POINTS:
- [point 1]
- [point 2]
- [point 3]`;

    const response = await this.prompt(input, systemPrompt);

    // Parse the response
    const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=KEY POINTS:|$)/s);
    const keyPointsMatch = response.match(/KEY POINTS:\s*(.+)/s);

    const summary = summaryMatch ? summaryMatch[1].trim() : response;
    const keyPoints = keyPointsMatch
      ? keyPointsMatch[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-\s*/, '').trim())
      : [];

    return {
      summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points extracted'],
      timestamp: Date.now(),
    };
  }

  /**
   * Explain a technical term
   */
  async explainTerm(term: string, context?: string): Promise<string> {
    const systemPrompt = `You are a helpful assistant that explains technical and scientific terms in simple language.`;

    const input = context
      ? `Explain the term "${term}" in the context of: ${context}`
      : `Explain the term "${term}" in simple terms`;

    return await this.prompt(input, systemPrompt);
  }

  /**
   * Simplify a section of text
   */
  async simplifyText(text: string): Promise<string> {
    const systemPrompt = `You are a helpful assistant that rewrites complex academic text in simple, clear language
while preserving the original meaning.`;

    const input = `Rewrite this text in simpler terms:\n\n${text}`;

    return await this.prompt(input, systemPrompt);
  }

  /**
   * Destroy the current session
   */
  destroySession() {
    if (this.session) {
      this.session.destroy();
      this.session = null;
    }
  }
}

// Export singleton instance
export const aiService = new ChromeAIService();
