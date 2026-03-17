import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, MessageSquare, Building2, User, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/language-context";

export default function WebsiteContact() {
  const { lang, t } = useLanguage();
  const contact = t.contact;
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);

  const contactSchema = z.object({
    name: z.string().min(2, contact.validationName),
    email: z.string().email(contact.validationEmail),
    company: z.string().optional(),
    message: z.string().min(10, contact.validationMessage),
  });
  type ContactForm = z.infer<typeof contactSchema>;

  const form = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", company: "", message: "" },
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
        const message = typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : contact.sendFailedDefault;
        throw new Error(message);
      }
      setSubmitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : contact.sendFailedDefault;
      toast({ title: contact.sendFailedTitle, description: message, variant: "destructive" });
    }
  }

  return (
    <MarketingLayout>
      <MarketingHead
        title={contact.meta.title}
        description={contact.meta.description}
        lang={lang}
      />
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {contact.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {contact.headline}
          </h1>
          <p className="text-lg text-gray-300">
            {contact.subheadline}
          </p>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-16">
            <div className="lg:col-span-2 space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3">{contact.contactTitle}</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {contact.contactDesc}
                </p>
              </div>

              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Mail className="h-4 w-4 text-green-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">{contact.emailLabel}</p>
                    <a href="mailto:hello@fnbcostpro.com" className="text-sm text-green-600 hover:underline">
                      hello@fnbcostpro.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <MessageSquare className="h-4 w-4 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">{contact.responseLabel}</p>
                    <p className="text-sm text-gray-500">{contact.responseDesc}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              {submitted ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center" data-testid="contact-success">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{contact.successTitle}</h3>
                  <p className="text-gray-500 text-sm max-w-xs">
                    {contact.successDesc}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6"
                    onClick={() => { setSubmitted(false); form.reset(); }}
                    data-testid="btn-send-another"
                  >
                    {contact.sendAnother}
                  </Button>
                </div>
              ) : (
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" data-testid="contact-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                        <User className="h-3.5 w-3.5" /> {contact.nameLabel} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="name"
                        {...form.register("name")}
                        placeholder={contact.namePlaceholder}
                        data-testid="input-contact-name"
                      />
                      {form.formState.errors.name && (
                        <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                        <Mail className="h-3.5 w-3.5" /> {contact.emailFormLabel} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        {...form.register("email")}
                        placeholder={contact.emailPlaceholder}
                        data-testid="input-contact-email"
                      />
                      {form.formState.errors.email && (
                        <p className="text-xs text-red-500">{form.formState.errors.email.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="company" className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Building2 className="h-3.5 w-3.5" /> {contact.companyLabel}
                    </Label>
                    <Input
                      id="company"
                      {...form.register("company")}
                      placeholder={contact.companyPlaceholder}
                      data-testid="input-contact-company"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="message" className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <MessageSquare className="h-3.5 w-3.5" /> {contact.messageLabel} <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="message"
                      {...form.register("message")}
                      placeholder={contact.messagePlaceholder}
                      rows={5}
                      data-testid="input-contact-message"
                    />
                    {form.formState.errors.message && (
                      <p className="text-xs text-red-500">{form.formState.errors.message.message}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-orange-500 text-white border-0"
                    disabled={form.formState.isSubmitting}
                    data-testid="btn-contact-submit"
                  >
                    {form.formState.isSubmitting ? contact.submitting : contact.submitButton}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
