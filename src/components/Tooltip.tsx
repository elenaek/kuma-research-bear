import { HelpCircle } from 'lucide-preact';

interface TooltipProps {
  text: string;
}

export function Tooltip({ text }: TooltipProps) {
  return (
    <span class="tooltip-container">
      <HelpCircle size={14} class="text-gray-400 hover:text-gray-600 transition-colors cursor-help" />
      <span class="tooltip-content">
        {text}
      </span>
    </span>
  );
}