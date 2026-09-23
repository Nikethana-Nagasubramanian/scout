"use client";

/**
 * A select inside the jobs GET form. The tab buttons submit the form themselves, but a
 * select has no submit of its own, so changing it applies immediately instead of waiting
 * for the next click somewhere else.
 */
export function FilterSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        defaultValue={value}
        id={id}
        name={name}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </>
  );
}
