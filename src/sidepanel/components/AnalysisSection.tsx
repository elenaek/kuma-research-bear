import { FileText, AlertTriangle, TrendingUp, AlertCircle, CheckCircle, Sparkles } from 'lucide-preact';
import { PaperAnalysisResult } from '../../types/index.ts';
import { Tooltip } from '../../components/Tooltip.tsx';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';
import { CollapsibleSection } from './ui/CollapsibleSection.tsx';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface AnalysisSectionProps {
  analysis: PaperAnalysisResult | null;
  isAnalyzing: boolean;
  analysisProgress?: {
    stage: 'evaluating' | 'analyzing';
    current?: number;
    total?: number;
  } | null;
  onGenerateAnalysis?: () => void;
}

/**
 * Analysis Section Component
 * Displays paper analysis results including methodology, confounders, implications, and limitations
 */
export function AnalysisSection(props: AnalysisSectionProps) {
  const { analysis, isAnalyzing, analysisProgress, onGenerateAnalysis } = props;

  // Helper to get step label
  const getStepLabel = (step: number): string => {
    switch (step) {
      case 1: return 'methodology';
      case 2: return 'confounders';
      case 3: return 'implications';
      case 4: return 'limitations';
      default: return '';
    }
  };

  // Loading state with progress
  if (isAnalyzing && !analysis) {
    let progressMessage = 'Analyzing Paper...';
    let progressDetail = 'Evaluating methodology, identifying confounders, analyzing implications, and assessing limitations.';

    if (analysisProgress) {
      if (analysisProgress.stage === 'evaluating' && analysisProgress.current !== undefined && analysisProgress.total !== undefined) {
        progressMessage = `Evaluating section(s): ${analysisProgress.current}/${analysisProgress.total}`;
        progressDetail = 'Evaluating the entirety of the paper\'s sections...';
      } else if (analysisProgress.stage === 'analyzing' && analysisProgress.current !== undefined && analysisProgress.total !== undefined) {
        const stepLabel = getStepLabel(analysisProgress.current);
        progressMessage = `Analyzing ${analysisProgress.current}/4`;
        progressDetail = stepLabel ? `Analyzing ${stepLabel}...` : 'Analyzing paper components...';
      }
    }

    return (
      <div class="card">
        <div class="flex flex-col items-center justify-center gap-4 py-12">
          <LottiePlayer path="/lotties/kuma-reading.lottie" className="mx-auto mb-1" autoStartLoop={true} size={140} loopPurpose={LoopPurpose.QASection} />
          <div class="text-center">
            <p class="text-base font-medium text-gray-900 mb-2">{progressMessage}</p>
            <p class="text-sm text-gray-600">
              {progressDetail}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No analysis yet
  if (!analysis) {
    return (
      <div class="card">
        <div class="text-center py-8">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" className="mx-auto mb-1" size={100} autoStartLoop={false} />
          <p class="text-gray-900 font-medium text-base mb-2">No analysis available yet</p>
          <p class="text-sm text-gray-600 mb-4">
            Click the button below to analyze this paper's methodology, confounders, implications, and limitations.
          </p>

          {onGenerateAnalysis && (
            <button
              onClick={onGenerateAnalysis}
              class="inline-flex items-center gap-2 px-4 py-2 bg-blue-400 hover:bg-blue-500 text-white rounded-lg transition-colors duration-200 font-medium hover:cursor-pointer active:scale-95"
            >
              <Sparkles size={18} />
              Generate Analysis
            </button>
          )}
        </div>
      </div>
    );
  }

  // Analysis results
  return (
    <>
      {/* Methodology Analysis */}
      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Methodology"
          icon={FileText}
          iconColor="text-blue-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={false}
        >
          <div class="space-y-2 sm:space-y-3">
            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Study Type
                <Tooltip text="The type of study (e.g. randomized controlled trial, cohort study, case-control study, etc.)" />
              </p>
              <p class="text-sm text-gray-600">
                <MarkdownRenderer content={analysis.methodology.studyType} />
              </p>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Study Design
                <Tooltip text="The overall framework and approach used to conduct the research study" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.methodology.studyDesign} /></p>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Data Collection
                <Tooltip text="Methods and procedures used to gather information and measurements for the study" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.methodology.dataCollection} /></p>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Sample Size
                <Tooltip text="The number of participants or observations included in the study" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.methodology.sampleSize} /></p>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Statistical Methods
                <Tooltip text="Analytical techniques and tests used to evaluate and interpret the data" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.methodology.statisticalMethods} /></p>
            </div>

            <div>
              <p class="text-sm font-medium text-green-700 mb-1 flex items-center gap-1">
                <CheckCircle size={14} />
                Strengths
                <Tooltip text="Notable positive aspects and robust elements of the research methodology" />
              </p>
              <ul class="space-y-1">
                {analysis.methodology.strengths.map((strength, idx) => (
                  <li key={idx} class="flex gap-2 text-sm text-gray-600">
                    <span class="text-green-600">•</span>
                    <MarkdownRenderer content={strength} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="text-sm font-medium text-yellow-700 mb-1 flex items-center gap-1">
                <AlertCircle size={14} />
                Concerns
                <Tooltip text="Potential weaknesses or issues identified in the research methodology" />
              </p>
              <ul class="space-y-1">
                {analysis.methodology.concerns.map((concern, idx) => (
                  <li key={idx} class="flex gap-2 text-sm text-gray-600">
                    <span class="text-yellow-600">•</span>
                    <MarkdownRenderer content={concern} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Confounders & Biases */}
      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Confounders & Biases"
          icon={AlertTriangle}
          iconColor="text-orange-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={false}
        >
          <div class="space-y-2 sm:space-y-3">
            <div>
              <p class="text-base font-medium text-gray-700 mb-1">
                Identified Confounders
                <Tooltip text="Variables that may influence both the independent and dependent variables, potentially distorting results" />
              </p>
              <ul class="space-y-3">
                {analysis.confounders.identified.map((item, idx) => (
                  <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                    <span class="font-medium text-gray-600">{item.name}</span>
                    <span class="text-gray-500 text-xs"><MarkdownRenderer content={item.explanation} /></span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="text-base font-medium text-gray-700 mb-1">
                Potential Biases
                <Tooltip text="Systematic errors or tendencies that could skew the study results in a particular direction" />
              </p>
              <ul class="space-y-3">
                {analysis.confounders.biases.map((bias, idx) => (
                  <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                    <span class="font-medium text-gray-600">{bias.name}</span>
                    <span class="text-gray-500 text-xs"><MarkdownRenderer content={bias.explanation} /></span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="text-base font-medium text-gray-700 mb-1">
                Control Measures
                <Tooltip text="Strategies implemented by researchers to minimize or account for confounders and biases" />
              </p>
              <ul class="space-y-3">
                {analysis.confounders.controlMeasures.map((controlMeasure, idx) => (
                  <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                    <span class="font-medium text-gray-600">{controlMeasure.name}</span>
                    <span class="text-gray-500 text-xs"><MarkdownRenderer content={controlMeasure.explanation} /></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Implications */}
      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Implications"
          icon={TrendingUp}
          iconColor="text-blue-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={false}
        >
          <div class="space-y-2 sm:space-y-3">
            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Significance
                <Tooltip text="The importance and meaning of the research findings within the field" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.implications.significance} /></p>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Possible Real-World Applications
                <Tooltip text="What the research findings may be applied to in the real world" />
              </p>
              <ul class="space-y-3">
                {analysis.implications.realWorldApplications.map((app, idx) => (
                  <li key={idx} class="flex gap-2 text-sm text-gray-600">
                    <span class="text-blue-600">•</span>
                    <MarkdownRenderer content={app} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                What could be Investigated Further
                <Tooltip text="Suggested areas for further investigation to build upon or address gaps in this research" />
              </p>
              <ul class="space-y-3">
                {analysis.implications.futureResearch.map((research, idx) => (
                  <li key={idx} class="flex gap-2 text-sm text-gray-600">
                    <span class="text-purple-600">•</span>
                    <MarkdownRenderer content={research} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Limitations */}
      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Limitations"
          icon={AlertCircle}
          iconColor="text-red-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={false}
        >
          <div class="space-y-2 sm:space-y-3">
            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Study Limitations
                <Tooltip text="Constraints and boundaries that may affect the validity or scope of the research findings" />
              </p>
              <ul class="space-y-3">
                {analysis.limitations.studyLimitations.map((limitation, idx) => (
                  <li key={idx} class="flex gap-2 text-sm text-gray-600">
                    <span class="text-red-600">•</span>
                    <MarkdownRenderer content={limitation} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="text-sm font-medium text-gray-700 mb-1">
                Generalizability
                <Tooltip text="The extent to which findings can be applied to other populations, settings, or contexts" />
              </p>
              <p class="text-sm text-gray-600"><MarkdownRenderer content={analysis.limitations.generalizability} /></p>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
}
