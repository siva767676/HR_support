// Single source of truth for landing copy. Crisp, specific, no em-dashes.

export const features = [
  { title: "Two-stage scoring", body: "A fast semantic shortlist narrows the field, then a language model scores each candidate in depth." },
  { title: "Scores you can defend", body: "Every candidate gets a 0 to 100 score across skills, experience, education, domain, and projects." },
  { title: "Generate job descriptions", body: "Turn a few inputs into a complete JD, formatted to your standard template." },
  { title: "Shortlist and notify", body: "Promote top candidates and email them from templates you control." },
  { title: "Built-in dashboard", body: "See throughput, score spread, and the recommendation mix for every run." },
  { title: "Private by default", body: "No third-party calls. Resumes never leave your servers." },
];

export const steps = [
  { n: "01", title: "Upload", body: "Add a folder of resumes and the job description." },
  { n: "02", title: "Shortlist", body: "Semantic search keeps the closest matches." },
  { n: "03", title: "Score", body: "The model rates five weighted dimensions per candidate." },
  { n: "04", title: "Rank", body: "Candidates are ordered by overall fit." },
  { n: "05", title: "Notify", body: "Email the shortlist from a saved template." },
  { n: "06", title: "Interview", body: "Move shortlisted candidates into the AI interview round." },
];

export const faqs = [
  { q: "What file formats does it accept?", a: "PDF, DOCX, TXT, and Markdown. Upload a full folder at once, up to 100 resumes per run." },
  { q: "How is each candidate scored?", a: "From 0 to 100 across five weighted areas: skills, experience, education and certifications, domain relevance, and projects. You can change the weights." },
  { q: "Does resume data leave our network?", a: "No. Screening runs on your infrastructure and uses your own language model. Resumes are never sent to outside services." },
  { q: "How many resumes can one run handle?", a: "Up to 100 by default. The semantic shortlist sends only the closest matches for deep scoring, which keeps runs fast and affordable." },
  { q: "Can we edit the job descriptions and emails?", a: "Yes. Review and edit a generated JD before saving, and tailor the notification templates for each role." },
  { q: "Does it replace the recruiter?", a: "No. It ranks and explains, and your team decides. Each result lists matched skills, gaps, and a short rationale." },
];
