export const navLinks = [
  { href: "/catalog", label: "Catalog" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/solutions", label: "Solutions" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export const categories = [
  {
    slug: "components",
    name: "Components",
    tagline: "Precision parts. Sourced on request.",
    description: "Semiconductors, passives, connectors, and power modules from authorized channels.",
    gradient: "from-zinc-900 via-zinc-800 to-zinc-950",
    accent: "text-blue-400",
  },
  {
    slug: "devices",
    name: "Devices",
    tagline: "Enterprise hardware. Available by inquiry.",
    description: "Laptops, networking gear, storage, and peripherals for fleet and resale programs.",
    gradient: "from-neutral-900 via-stone-900 to-black",
    accent: "text-violet-400",
  },
  {
    slug: "industrial",
    name: "Industrial",
    tagline: "Built for production lines.",
    description: "PLCs, sensors, automation kits, and ruggedized equipment for manufacturing.",
    gradient: "from-slate-900 via-slate-800 to-zinc-950",
    accent: "text-emerald-400",
  },
];

export const featuredProducts = [
  {
    name: "SnapCore MCU Series",
    category: "Components",
    spec: "ARM Cortex-M · 512KB Flash",
  },
  {
    name: "HubLink Pro Switch",
    category: "Devices",
    spec: "48-port · 10GbE uplink",
  },
  {
    name: "EdgeSense IoT Kit",
    category: "Industrial",
    spec: "Temperature · Vibration · MQTT",
  },
];

export const solutions = [
  {
    title: "OEM & Manufacturing",
    description: "BOM sourcing, cross-reference support, and scheduled deliveries aligned to your production calendar.",
    stats: ["Custom sourcing", "ERP integration", "Volume programs"],
  },
  {
    title: "IT Resellers & MSPs",
    description: "Fulfillment partnerships, serialized tracking, and account-based programs for your customer base.",
    stats: ["Net-30 terms", "Drop-ship ready", "Dedicated rep"],
  },
  {
    title: "Startup & R&D",
    description: "Low MOQs, rapid prototyping kits, and engineering support for early-stage hardware teams.",
    stats: ["Sample programs", "Datasheet library", "Fast turnaround"],
  },
];

export const wholesaleFeatures = [
  {
    title: "Dedicated account team",
    body: "A single point of contact who understands your product lines, lead times, and sourcing needs.",
  },
  {
    title: "Availability on request",
    body: "Tell us what you need — we confirm stock, lead time, and options before anything moves forward.",
  },
  {
    title: "BOM & bulk inquiries",
    body: "Send a parts list or project brief. We respond with availability and terms tailored to your order.",
  },
  {
    title: "Flexible payment terms",
    body: "Net-30 and Net-60 options for qualified business accounts, arranged during onboarding.",
  },
];

export const stats = [
  { value: "3", label: "Core product lines" },
  { value: "24hr", label: "Inquiry response time" },
  { value: "99.2%", label: "Fill rate" },
  { value: "500+", label: "Business accounts" },
];

export const partners = [
  "Avnet Authorized",
  "Arrow Partner",
  "Digi-Key Supply",
  "Mouser Channel",
  "TD Synnex",
];
