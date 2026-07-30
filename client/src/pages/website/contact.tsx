import { useState, useRef } from "react";
import { track } from "@/lib/analytics";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, Clock, CheckCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/language-context";

// Styled native select that matches the Input component appearance
function FormSelect({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  options,
  error,
  name,
}: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onBlur: () => void;
  placeholder: string;
  options: { value: string; label: string }[];
  error?: string;
  name: string;
}) {
  return (
    <div>
      <select
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export default function WebsiteContact() {
  const { lang, t } = useLanguage();
  const c = t.contact;
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const formStartedRef = useRef(false);
  function handleFormFocus() {
    if (!formStartedRef.current) {
      formStartedRef.current = true;
      track("contact_form_started", { language: lang });
    }
  }

  const contactSchema = z.object({
    name: z.string().min(2, c.validationName),
    email: z.string().email(c.validationEmail),
    company: z.string().optional(),
    operationType: z.string().min(1, c.validationOperationType),
    locationCount: z.string().min(1, c.validationLocationCount),
    role: z.string().min(1, c.validationRole),
    currentSystem: z.string().optional(),
    primaryChallenge: z.string().min(10, c.validationChallenge),
    contactPreference: z.string().optional(),
  });
  type ContactForm = z.infer<typeof contactSchema>;

  const form = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      operationType: "",
      locationCount: "",
      role: "",
      currentSystem: "",
      primaryChallenge: "",
      contactPreference: "",
    },
  });

  async function onSubmit(values: ContactForm) {
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        const message =
          typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : c.sendFailedDefault;
        throw new Error(message);
      }
      setSubmitted(true);
      track("contact_form_submitted", { language: lang });
    } catch (err) {
      const message = err instanceof Error ? err.message : c.sendFailedDefault;
      toast({ title: c.sendFailedTitle, description: message, variant: "destructive" });
    }
  }

  const steps = [
    { label: c.step1Label, desc: c.step1Desc, num: "1" },
    { label: c.step2Label, desc: c.step2Desc, num: "2" },
    { label: c.step3Label, desc: c.step3Desc, num: "3" },
  ];

  return (
    <MarketingLayout>
      <MarketingHead title={c.meta.title} description={c.meta.description} lang={lang} />

      {/* Hero */}
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {c.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
            {c.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed max-w-2xl mx-auto">
            {c.subheadline}
          </p>
        </div>
      </section>

      {/* Form section */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-16">

            {/* Left: what to expect */}
            <div className="lg:col-span-2 space-y-8">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-3">{c.contactTitle}</h2>
                <p className="text-gray-500 text-sm leading-relaxed">{c.contactDesc}</p>
              </div>

              {/* 3-step process */}
              <ol className="space-y-5">
                {steps.map((step) => (
                  <li key={step.num} className="flex gap-4">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                      {step.num}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-0.5">{step.label}</p>
                      <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {/* Contact details */}
              <div className="space-y-4 pt-2 border-t border-gray-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Mail className="h-4 w-4 text-green-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">{c.emailLabel}</p>
                    <a href="mailto:hello@fnbcostpro.com" className="text-sm text-green-600 hover:underline">
                      hello@fnbcostpro.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Clock className="h-4 w-4 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">{c.responseLabel}</p>
                    <p className="text-sm text-gray-500">{c.responseDesc}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: form */}
            <div className="lg:col-span-3">
              {submitted ? (
                <div
                  className="flex flex-col items-center justify-center h-full min-h-[420px] text-center"
                  data-testid="contact-success"
                >
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{c.successTitle}</h3>
                  <p className="text-gray-500 text-sm max-w-xs leading-relaxed">{c.successDesc}</p>
                  <Button
                    variant="outline"
                    className="mt-6"
                    onClick={() => { setSubmitted(false); form.reset(); }}
                    data-testid="btn-send-another"
                  >
                    {c.sendAnother}
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-5"
                  data-testid="contact-form"
                  onFocus={handleFormFocus}
                >
                  {/* Name + Email */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                        {c.nameLabel} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="name"
                        {...form.register("name")}
                        placeholder={c.namePlaceholder}
                        data-testid="input-contact-name"
                      />
                      {form.formState.errors.name && (
                        <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                        {c.emailFormLabel} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        {...form.register("email")}
                        placeholder={c.emailPlaceholder}
                        data-testid="input-contact-email"
                      />
                      {form.formState.errors.email && (
                        <p className="text-xs text-red-500">{form.formState.errors.email.message}</p>
                      )}
                    </div>
                  </div>

                  {/* Company */}
                  <div className="space-y-1.5">
                    <Label htmlFor="company" className="text-sm font-medium text-gray-700">
                      {c.companyLabel}
                    </Label>
                    <Input
                      id="company"
                      {...form.register("company")}
                      placeholder={c.companyPlaceholder}
                      data-testid="input-contact-company"
                    />
                  </div>

                  {/* Operation type + Role */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="operationType" className="text-sm font-medium text-gray-700">
                        {c.operationTypeLabel} <span className="text-red-500">*</span>
                      </Label>
                      <FormSelect
                        id="operationType"
                        name="operationType"
                        value={form.watch("operationType")}
                        onChange={(e) => form.setValue("operationType", e.target.value, { shouldValidate: true })}
                        onBlur={() => form.trigger("operationType")}
                        placeholder={c.operationTypePlaceholder}
                        options={c.operationTypeOptions}
                        error={form.formState.errors.operationType?.message}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="role" className="text-sm font-medium text-gray-700">
                        {c.roleLabel} <span className="text-red-500">*</span>
                      </Label>
                      <FormSelect
                        id="role"
                        name="role"
                        value={form.watch("role")}
                        onChange={(e) => form.setValue("role", e.target.value, { shouldValidate: true })}
                        onBlur={() => form.trigger("role")}
                        placeholder={c.rolePlaceholder}
                        options={c.roleOptions}
                        error={form.formState.errors.role?.message}
                      />
                    </div>
                  </div>

                  {/* Location count + Current system */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="locationCount" className="text-sm font-medium text-gray-700">
                        {c.locationCountLabel} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="locationCount"
                        {...form.register("locationCount")}
                        placeholder={c.locationCountPlaceholder}
                        data-testid="input-contact-location-count"
                      />
                      {form.formState.errors.locationCount && (
                        <p className="text-xs text-red-500">{form.formState.errors.locationCount.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="currentSystem" className="text-sm font-medium text-gray-700">
                        {c.currentSystemLabel}
                      </Label>
                      <Input
                        id="currentSystem"
                        {...form.register("currentSystem")}
                        placeholder={c.currentSystemPlaceholder}
                        data-testid="input-contact-current-system"
                      />
                    </div>
                  </div>

                  {/* Primary challenge */}
                  <div className="space-y-1.5">
                    <Label htmlFor="primaryChallenge" className="text-sm font-medium text-gray-700">
                      {c.challengeLabel} <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="primaryChallenge"
                      {...form.register("primaryChallenge")}
                      placeholder={c.challengePlaceholder}
                      rows={4}
                      data-testid="input-contact-challenge"
                    />
                    {form.formState.errors.primaryChallenge && (
                      <p className="text-xs text-red-500">{form.formState.errors.primaryChallenge.message}</p>
                    )}
                  </div>

                  {/* Contact preference */}
                  <div className="space-y-1.5">
                    <Label htmlFor="contactPreference" className="text-sm font-medium text-gray-700">
                      {c.contactPrefLabel}
                    </Label>
                    <FormSelect
                      id="contactPreference"
                      name="contactPreference"
                      value={form.watch("contactPreference") ?? ""}
                      onChange={(e) => form.setValue("contactPreference", e.target.value)}
                      onBlur={() => {}}
                      placeholder={c.contactPrefPlaceholder}
                      options={c.contactPrefOptions}
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white border-0 h-11 text-base font-semibold gap-1"
                    disabled={form.formState.isSubmitting}
                    data-testid="btn-contact-submit"
                  >
                    {form.formState.isSubmitting ? c.submitting : c.submitButton}
                    {!form.formState.isSubmitting && <ChevronRight className="h-4 w-4" />}
                  </Button>

                  <p className="text-xs text-gray-400 text-center">
                    * {lang === "es" ? "Campos requeridos" : "Required fields"}
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
