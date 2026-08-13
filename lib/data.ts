export const navLinks = [
  { href: "/catalog", label: "Divisions" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/solutions", label: "Solutions" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export const divisions = [
  {
    slug: "ai",
    name: "AI Systems",
    tagline: "Configured platforms for AI teams.",
    description:
      "Value-added reseller — we source components and configure novel AI systems: multi-GPU workstations, inference servers, and edge appliances, built and validated for your workload.",
    gradient: "from-emerald-950 via-teal-900 to-black",
    accent: "text-emerald-400",
  },
  {
    slug: "gaming",
    name: "Gaming",
    tagline: "Systems and CPUs for consumer channels.",
    description:
      "Gaming desktops, gaming CPUs, and complete systems sourced for retailers, e-tailers, and integrators who sell to end consumers.",
    gradient: "from-violet-950 via-purple-900 to-black",
    accent: "text-violet-400",
  },
  {
    slug: "infrastructure",
    name: "Infrastructure",
    tagline: "Server hardware for channel partners.",
    description:
      "Rack servers, storage, and networking sourced for resellers and IT partners — inquiry-based, with specs and availability confirmed on each request.",
    gradient: "from-slate-900 via-blue-950 to-black",
    accent: "text-blue-400",
  },
];

/** @deprecated Use divisions — kept as alias for catalog filters */
export const categories = divisions;

export const featuredProducts = [
  {
    name: "Inference Workstation",
    category: "AI Systems",
    spec: "Multi-GPU · Custom config · Burn-in",
  },
  {
    name: "Gaming Desktop",
    category: "Gaming",
    spec: "High-end CPU · Discrete GPU · Ready to ship",
  },
  {
    name: "Rack Server",
    category: "Infrastructure",
    spec: "2U · Enterprise CPU · Expandable storage",
  },
];

export const solutions = [
  {
    title: "AI Startups & Labs",
    description:
      "Novel AI systems configured to your workload — inference, fine-tuning, or edge deployment. We source the hardware, assemble, validate, and ship ready to run.",
    stats: ["Multi-GPU builds", "Custom configuration", "Burn-in & validation"],
  },
  {
    title: "Gaming & Consumer Channels",
    description:
      "Gaming desktops and CPUs for partners selling to end consumers. Share your SKU requirements or volume needs — we confirm sourcing options on inquiry.",
    stats: ["Complete systems", "Gaming CPUs", "Channel sourcing"],
  },
  {
    title: "Server Resellers & IT Partners",
    description:
      "Server, storage, and networking hardware for resellers who need a responsive sourcing partner. Every quote is built around your specific request.",
    stats: ["Rack servers", "Storage", "Networking"],
  },
];

export const wholesaleFeatures = [
  {
    title: "Direct follow-up",
    body: "Every inquiry gets a personal response — no ticket queue, no self-service cart. We confirm specs, availability, and lead time before anything moves forward.",
  },
  {
    title: "Cross-division sourcing",
    body: "Gaming, AI systems, and infrastructure under one company. One inquiry can cover multiple product lines when your project spans them.",
  },
  {
    title: "Configuration as value-add",
    body: "Our AI Systems line goes beyond sourcing — we configure, assemble, and validate platforms that off-the-shelf catalogs don't cover.",
  },
  {
    title: "Terms per engagement",
    body: "Pricing and payment terms are quoted on each inquiry. No published price lists — we build quotes around your specific requirements.",
  },
];

export const capabilities = [
  { value: "3", label: "Focused business lines" },
  { value: "24hr", label: "Inquiry response target" },
  { value: "VAR", label: "AI system configuration" },
  { value: "B2B", label: "Inquiry-based only" },
];

/** @deprecated Use capabilities */
export const stats = capabilities;

export const industryExperience =
  "We've done business across the server, gaming, and AI hardware supply chain — with distributors, OEMs, and channel partners that serve these industries.";
