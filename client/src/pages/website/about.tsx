import { Target, Heart, Lightbulb } from "lucide-react";
import { MarketingLayout, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";

const VALUES = [
  {
    icon: Target,
    title: "Built for Operators, by Operators",
    body: "FnB Cost Pro was designed by people who understand F&B — the margins, the vendors, the chaos of a busy kitchen. Every feature exists because real Food & Beverage operators needed it.",
  },
  {
    icon: Heart,
    title: "Simplicity First",
    body: "We believe powerful doesn't have to mean complicated. Our guided onboarding walks any operator through setup — tech-savvy or not — so you see value from day one without the frustration.",
  },
  {
    icon: Lightbulb,
    title: "Continuous Improvement",
    body: "The F&B industry never stands still. We ship updates regularly based on direct feedback from our customers, so the platform grows as your needs evolve.",
  },
];

const WHO_ITS_FOR = [
  { title: "Independent Restaurants", body: "Full-service, quick service, or fast casual — any restaurant that wants to know and control their food costs." },
  { title: "Multi-Unit Operators", body: "Manage inventory, recipes, and team access across every location from a single dashboard." },
  { title: "Catering Operations", body: "Cost events accurately, track inventory across runs, and eliminate the guesswork on per-head pricing." },
  { title: "Food & Beverage Managers", body: "Arm yourself with the data to have confident conversations about cost, waste, and pricing with ownership." },
  { title: "Ghost Kitchens & Dark Kitchens", body: "Precise recipe costing and vendor management built for high-SKU, multi-concept environments." },
  { title: "Bars & Nightclubs", body: "Track liquor inventory, cost cocktail recipes, and spot variance between poured and sold." },
];

export default function WebsiteAbout() {
  return (
    <MarketingLayout>
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            Our Story
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">
            We Built the Tool We Wished We Had
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed">
            FnB Cost Pro was born out of frustration with spreadsheets, expensive enterprise software, and tools that weren't built for the reality of running an F&amp;B operation.
          </p>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">Our Mission</h2>
            <p className="text-gray-500 text-lg leading-relaxed mb-6">
              Food &amp; Beverage (F&amp;B) is one of the most margin-sensitive industries in the world. A 1–2% shift in food cost can be the difference between a profitable month and a loss. Yet most F&amp;B operators are flying blind — relying on gut feel, end-of-month statements, or a patchwork of spreadsheets to understand where their money is going.
            </p>
            <p className="text-gray-500 text-lg leading-relaxed mb-6">
              FnB Cost Pro exists to change that. We give F&amp;B operators the tools to know their costs in real time, catch waste before it compounds, and make confident decisions about pricing, purchasing, and staffing.
            </p>
            <p className="text-gray-500 text-lg leading-relaxed">
              We believe every Food &amp; Beverage operator — from a single-location restaurant to a multi-unit F&amp;B group — deserves access to professional-grade food cost management at a price that makes sense for their business.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading label="Our Values" title="What Drives Us" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {VALUES.map((v) => (
              <div key={v.title} className="bg-white rounded-lg border border-gray-100 p-6" data-testid={`value-${v.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center mb-4">
                  <v.icon className="h-5 w-5 text-green-700" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label="Who It's For"
            title="Built for the Full Spectrum of F&B"
            subtitle="From independent restaurants to large F&B groups and multi-unit Food & Beverage operations, FnB Cost Pro scales with you."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHO_ITS_FOR.map((item) => (
              <div
                key={item.title}
                className="p-5 rounded-lg bg-gray-50 border border-gray-100 hover-elevate"
                data-testid={`who-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <h4 className="text-sm font-semibold text-gray-900 mb-2">{item.title}</h4>
                <p className="text-xs text-gray-500 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-green-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to See What FnB Cost Pro Can Do?
          </h2>
          <p className="text-green-200 mb-8">
            Start your 30-day free trial. Cancel anytime before it ends and you owe nothing.
          </p>
          <CTAButton href={appLink("/signup")} large>
            Get Started Free
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}
