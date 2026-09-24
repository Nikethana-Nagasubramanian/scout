/**
 * One definition of "ready to apply", shared by the export script and the queue API.
 *
 * `applications.status` alone is not enough. A resume can be rejected after its
 * application was queued, which leaves the application sitting at 'ready_to_apply' with a
 * set-aside resume - the Queue page already treats those as rejected, and anything that
 * hands documents to an applier has to agree, or it submits a resume the user threw out.
 *
 * The resume used is the job's latest version, which is the one the user reviewed.
 */
export const READY_TO_APPLY_QUERY = `
  SELECT applications.id AS application_id, jobs.id AS job_id,
    jobs.company, jobs.title, jobs.location, jobs.apply_url, jobs.canonical_url, jobs.description,
    latest_resume.id AS resume_id, latest_resume.content_json, latest_resume.status AS resume_status,
    cover_letters.id AS cover_letter_id,
    cover_letters.content AS letter_content,
    cover_letters.updated_at AS letter_updated_at,
    cover_letters.status AS letter_status
  FROM applications
  JOIN jobs ON jobs.id = applications.job_id
  JOIN resume_versions AS latest_resume ON latest_resume.id = (
    SELECT candidate.id FROM resume_versions AS candidate
    WHERE candidate.job_id = jobs.id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  )
  LEFT JOIN cover_letters ON cover_letters.application_id = applications.id
  WHERE applications.status = 'ready_to_apply'
    AND latest_resume.status != 'rejected'
  ORDER BY applications.id
`;
