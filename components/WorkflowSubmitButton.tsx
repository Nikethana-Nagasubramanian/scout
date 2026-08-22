"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export function WorkflowSubmitButton({
  children,
  className = "button",
  sourceCount = 0,
}: {
  children: React.ReactNode;
  className?: string;
  sourceCount?: number;
}) {
  const { pending } = useFormStatus();
  const [activeStep, setActiveStep] = useState(0);
  const steps = [
    `Checking ${sourceCount || "your"} sources`,
    "Reviewing roles",
    "Verifying eligibility",
    "Finding roles worth your time",
  ];

  useEffect(() => {
    if (!pending) {
      const resetTimer = window.setTimeout(() => setActiveStep(0), 0);
      return () => window.clearTimeout(resetTimer);
    }

    const timers = [
      window.setTimeout(() => setActiveStep(1), 2600),
      window.setTimeout(() => setActiveStep(2), 5200),
      window.setTimeout(() => setActiveStep(3), 7800),
    ];

    return () => timers.forEach(window.clearTimeout);
  }, [pending]);

  return (
    <>
      <button className={className} type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Fetching jobs..." : children}
      </button>
      {pending ? (
        <div className="jobs-fetch-overlay" role="status" aria-live="polite">
          <div className="jobs-fetch-loader" aria-hidden="true"><span /><span /><span /></div>
          <div className="jobs-fetch-copy">
            <strong key={steps[activeStep]}>{steps[activeStep]}</strong>
            <ol>
              {steps.map((step, index) => (
                <li className={index === activeStep ? "active" : index < activeStep ? "done" : undefined} key={step}>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          <div className="jobs-fetch-skeleton" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
        </div>
      ) : null}
    </>
  );
}
