import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceMeter, ProvenanceBadge, RiskBadge, VerificationBadge, bandOf } from './index';

describe('trust signals', () => {
  it('phrases confidence as likelihood, never as confirmation', () => {
    render(<ConfidenceMeter value={0.92} />);
    expect(screen.getByText(/Relative likelihood/)).toBeInTheDocument();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  });
  it('bands confidence consistently with the API', () => {
    expect(bandOf(0.8)).toBe('high');
    expect(bandOf(0.5)).toBe('moderate');
    expect(bandOf(0.3)).toBe('low');
    expect(bandOf(0.1)).toBe('very_low');
  });
  it('marks high-risk work as professional-only', () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByText(/professionals only/)).toBeInTheDocument();
  });
  it('labels AI-generated and demo provenance explicitly', () => {
    render(<><ProvenanceBadge provenance="ai_generated" /><ProvenanceBadge provenance="demo" /><VerificationBadge status="pending_review" /></>);
    expect(screen.getByText('AI-generated guidance')).toBeInTheDocument();
    expect(screen.getByText(/Demonstration data/)).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
  });
});
