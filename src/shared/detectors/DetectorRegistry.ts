import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';
import { ArxivDetector } from './ArxivDetector.ts';
import { PubmedDetector } from './PubmedDetector.ts';
import { BiorxivDetector } from './BiorxivDetector.ts';
import { IEEEDetector } from './IEEEDetector.ts';
import { ACMDetector } from './ACMDetector.ts';
import { ScienceDirectDetector } from './ScienceDirectDetector.ts';
import { NatureDetector } from './NatureDetector.ts';
import { ScienceDetector } from './ScienceDetector.ts';
import { PNASDetector } from './PNASDetector.ts';
import { SSRNDetector } from './SSRNDetector.ts';
import { SemanticScholarDetector } from './SemanticScholarDetector.ts';
import { SpringerDetector } from './SpringerDetector.ts';
import { SchemaOrgDetector } from './SchemaOrgDetector.ts';

/**
 * Registry for managing all paper detectors
 * Handles detector initialization and provides unified interface for paper detection
 */
export class DetectorRegistry {
  private detectors: BasePaperDetector[];

  constructor() {
    // Initialize all detectors
    this.detectors = [
      new SchemaOrgDetector(),
      new ArxivDetector(),
      new PubmedDetector(),
      new BiorxivDetector(),
      new IEEEDetector(),
      new ACMDetector(),
      new ScienceDirectDetector(),
      new NatureDetector(),
      new ScienceDetector(),
      new PNASDetector(),
      new SpringerDetector(),
      new SemanticScholarDetector(),
      new SSRNDetector(),
    ];

    // Sort by priority (highest first)
    this.detectors.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Attempt to detect a research paper using all registered detectors
   * Returns the first successful detection result
   */
  detectPaper(): ResearchPaper | null {
    for (const detector of this.detectors) {
      try {
        if (detector.canDetect()) {
          const paper = detector.detect();
          if (paper) {
            return paper;
          }
        }
      } catch (error) {
        console.error(`Error in ${detector.name} detector:`, error);
        // Continue to next detector
      }
    }
    return null;
  }

  /**
   * Get all registered detectors (sorted by priority)
   */
  getAllDetectors(): BasePaperDetector[] {
    return [...this.detectors];
  }

  /**
   * Get a specific detector by name
   */
  getDetector(name: string): BasePaperDetector | undefined {
    return this.detectors.find(d => d.name === name);
  }

  /**
   * Get all detectors that can detect the current page
   */
  getApplicableDetectors(): BasePaperDetector[] {
    return this.detectors.filter(d => {
      try {
        return d.canDetect();
      } catch (error) {
        console.error(`Error checking if ${d.name} can detect:`, error);
        return false;
      }
    });
  }
}
