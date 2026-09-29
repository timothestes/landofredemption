"use client";

import { useState, useEffect } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { submitRegistration } from "./actions";
import TopNav from "../../components/top-nav";
import SiteFooter from "../../components/site-footer";
import { createClient } from "../../utils/supabase/client";
import { getUserSafe } from "../../utils/supabase/getUserSafe";
import { NATIONALS_CONFIG } from "../config/nationals";
import { useIsAdmin } from "../../hooks/useIsAdmin";

export default function RegistrationPage() {
  const [user, setUser] = useState(null);
  const supabase = createClient();
  const { isAdmin, loading: adminLoading } = useIsAdmin();

  useEffect(() => {
    const getUser = async () => {
      const currentUser = await getUserSafe(supabase);
      setUser(currentUser);
      
      // Check if registration is admin-only (wait for admin loading to complete)
      if (NATIONALS_CONFIG.adminOnly && !adminLoading) {
        if (!currentUser || !isAdmin) {
          window.location.href = "/";
          return;
        }
      }
    };
    getUser();
  }, [adminLoading, isAdmin]);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    discordUsername: "",
    thursdayEvent: "",
    fridayEvent: "",
    saturdayEvent: "",
    fantasyDraftOptIn: false,
    firstNationals: false,
    needsAirportTransportation: false,
    needsHotelTransportation: false,
    ironManInterest: false,
    stayingOvernight: false,
    overnightStayNights: [] as string[],
    lunchThursday: false,
    lunchFriday: false,
    lunchSaturday: false,
    lunchSaturdayNoPickles: false,
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const [showThankYou, setShowThankYou] = useState(false);

  // Reset form when navigating back to registration from header
  useEffect(() => {
    const handleNavigate = () => {
      if (showThankYou) {
        setShowThankYou(false);
        setFormData({
          firstName: "",
          lastName: "",
          email: "",
          discordUsername: "",
          thursdayEvent: "",
          fridayEvent: "",
          saturdayEvent: "",
          fantasyDraftOptIn: false,
          firstNationals: false,
          needsAirportTransportation: false,
          needsHotelTransportation: false,
          ironManInterest: false,
          stayingOvernight: false,
          overnightStayNights: [],
          lunchThursday: false,
          lunchFriday: false,
          lunchSaturday: false,
          lunchSaturdayNoPickles: false,
        });
        setPhotoFile(null);
        setPhotoPreview(null);
      }
    };

    // Listen for clicks on the page (specifically for header navigation)
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[href="/register"]');
      if (link && showThankYou) {
        handleNavigate();
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showThankYou]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 15MB)
      if (file.size > 15 * 1024 * 1024) {
        setSubmitStatus({
          type: "error",
          message: "Picture must be smaller than 15MB",
        });
        return;
      }
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setSubmitStatus({
          type: "error",
          message: "Please upload an image file",
        });
        return;
      }
      
      setPhotoFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus({ type: null, message: "" });

    // Validate required fields
    if (!formData.firstName || !formData.lastName || !formData.email) {
      setSubmitStatus({
        type: "error",
        message: "Please fill in all required fields.",
      });
      setIsSubmitting(false);
      return;
    }

    if (!formData.thursdayEvent || !formData.fridayEvent || !formData.saturdayEvent) {
      setSubmitStatus({
        type: "error",
        message: "Please select an option for each day's event.",
      });
      setIsSubmitting(false);
      return;
    }

    // Upload photo if provided
    let photoUrl = null;
    if (photoFile) {
      setIsUploadingPhoto(true);
      const fileName = `${Date.now()}-${photoFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, photoFile);
      
      setIsUploadingPhoto(false);
      
      if (uploadError) {
        setSubmitStatus({
          type: "error",
          message: "Failed to upload picture. Please try again.",
        });
        setIsSubmitting(false);
        return;
      }
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      
      photoUrl = publicUrl;
    }

    const result = await submitRegistration(formData, photoUrl);

    if (result.success) {
      setShowThankYou(true);
    } else {
      setSubmitStatus({
        type: "error",
        message: result.error || "An error occurred. Please try again.",
      });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {user && <TopNav />}
      
      <div className="flex-1 w-full overflow-auto px-5">
        <div className="max-w-3xl mx-auto py-8">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-2">
            Tournament Registration
          </h1>
          <p className="text-muted-foreground mb-6">
            Register for the {NATIONALS_CONFIG.year} National Redemption Tournament
            {" \u00B7 "}
            {NATIONALS_CONFIG.dates}
            {" \u00B7 "}
            <a
              href="/articles/2026-redemption-national-tournament-wilmore-ky"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Learn more
            </a>
          </p>

          {showThankYou ? (
            <div className="bg-card border-2 border-border rounded-xl shadow-lg p-8 md:p-12 text-center space-y-8">
              {/* Success Icon with Animation */}
              <div className="relative">
                <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <svg
                    className="w-14 h-14 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                {/* Decorative Rings */}
                <div className="absolute inset-0 w-24 h-24 mx-auto border-4 border-green-300 dark:border-green-700 rounded-full animate-ping opacity-20"></div>
              </div>
              
              {/* Success Message */}
              <div className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                  Registration Complete!
                </h2>
                <p className="text-xl text-foreground">
                  Thank you for registering{formData.firstName ? `, ${formData.firstName}` : ''}! 🎉
                </p>
                <p className="text-sm text-muted-foreground">
                  We're excited to see you at Nationals {NATIONALS_CONFIG.year}
                </p>
              </div>

              {/* What's Next Section */}
              <div className="bg-muted p-6 rounded-xl shadow-md border border-border">
                <p className="font-bold text-lg mb-4 text-foreground">
                  📋 What's next?
                </p>
                <ul className="text-left space-y-3 max-w-md mx-auto">
                  <li className="flex items-start gap-3 text-foreground">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>Check your email for a confirmation message</span>
                  </li>
                  <li className="flex items-start gap-3 text-foreground">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>We'll send updates about the venue and schedule</span>
                  </li>
                  <li className="flex items-start gap-3 text-foreground">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>Hotel and transportation details coming soon</span>
                  </li>
                </ul>
              </div>

              {/* Contact Section */}
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground">
                  Questions? Contact Brian at{" "}
                  <a
                    href="mailto:Brianjones121191@gmail.com"
                    className="font-semibold text-foreground hover:text-green-600 dark:hover:text-green-400 underline decoration-2 underline-offset-2"
                  >
                    Brianjones121191@gmail.com
                  </a>
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-4">
                <Button
                  onClick={() => {
                    setShowThankYou(false);
                    setFormData({
                      firstName: "",
                      lastName: "",
                      email: "",
                      discordUsername: "",
                      thursdayEvent: "",
                      fridayEvent: "",
                      saturdayEvent: "",
                      fantasyDraftOptIn: false,
                      firstNationals: false,
                      needsAirportTransportation: false,
                      needsHotelTransportation: false,
                      ironManInterest: false,
                      stayingOvernight: false,
                      overnightStayNights: [],
                      lunchThursday: false,
                      lunchFriday: false,
                      lunchSaturday: false,
                      lunchSaturdayNoPickles: false,
                    });
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  variant="outline"
                  className="font-semibold px-8 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
                  size="lg"
                >
                  ➕ Register Another Person
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg shadow-sm p-8 jayden-gradient-bg">
              <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Personal Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData({ ...formData, firstName: e.target.value })
                    }
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData({ ...formData, lastName: e.target.value })
                    }
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="discordUsername">Discord Username</Label>
                <Input
                  id="discordUsername"
                  type="text"
                  value={formData.discordUsername}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      discordUsername: e.target.value,
                    })
                  }
                  placeholder="(optional)"
                  className="w-full"
                />
              </div>
            </div>

            {/* Picture Upload Section */}
            <div className="space-y-4 pt-2">
              <h2 className="text-xl font-semibold">
                Name Tag Picture
              </h2>
              
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Upload a picture to use on your custom name tag (optional). Max 15MB.
                </p>
                <input
                  id="photo"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="block w-full text-sm text-foreground file:ml-2 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary/15 file:text-primary hover:file:bg-primary/25 cursor-pointer"
                />
                {photoPreview && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Preview:</p>
                    <img
                      src={photoPreview}
                      alt="Picture preview"
                      className="w-32 h-32 object-cover rounded-lg border-2 border-border shadow-sm"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Event Selection */}
            <div className="space-y-4 pt-4">
              <h2 className="text-xl font-semibold">
                Event Selection
              </h2>

              {/* Thursday */}
              <div className="space-y-3 p-4 bg-card rounded-lg border-2 border-border">
                <h3 className="font-semibold">
                  Thursday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.thursday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.thursday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          thursdayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.thursdayEvent === event.value
                          ? 'text-primary'
                          : 'hover:text-primary'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.thursdayEvent === event.value
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground'
                      }`}>
                        {formData.thursdayEvent === event.value && (
                          <div className="w-2 h-2 bg-primary-foreground rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Friday */}
              <div className="space-y-3 p-4 bg-card rounded-lg border-2 border-border">
                <h3 className="font-semibold">
                  Friday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.friday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.friday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          fridayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.fridayEvent === event.value
                          ? 'text-primary'
                          : 'hover:text-primary'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.fridayEvent === event.value
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground'
                      }`}>
                        {formData.fridayEvent === event.value && (
                          <div className="w-2 h-2 bg-primary-foreground rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Saturday */}
              <div className="space-y-3 p-4 bg-card rounded-lg border-2 border-border">
                <h3 className="font-semibold">
                  Saturday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.saturday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.saturday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          saturdayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.saturdayEvent === event.value
                          ? 'text-primary'
                          : 'hover:text-primary'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.saturdayEvent === event.value
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground'
                      }`}>
                        {formData.saturdayEvent === event.value && (
                          <div className="w-2 h-2 bg-primary-foreground rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Lunch */}
            <div className="space-y-4 pt-4">
              <h2 className="text-xl font-semibold">
                Lunch
              </h2>
              <p className="text-sm text-muted-foreground">
                Let us know which days you plan to eat lunch at the venue. Each meal
                includes a choice of chips, a cookie, and a drink. Pay at check-in
                along with your event fees.
              </p>
              <div className="space-y-3 p-4 bg-card rounded-lg border-2 border-border">
                {[
                  { key: "lunchThursday", label: "Thursday", date: NATIONALS_CONFIG.eventDates.thursday, price: NATIONALS_CONFIG.lunchPrices.thursday },
                  { key: "lunchFriday", label: "Friday", date: NATIONALS_CONFIG.eventDates.friday, price: NATIONALS_CONFIG.lunchPrices.friday },
                  { key: "lunchSaturday", label: "Saturday", date: NATIONALS_CONFIG.eventDates.saturday, price: NATIONALS_CONFIG.lunchPrices.saturday },
                ].map((day) => {
                  const fieldKey = day.key as "lunchThursday" | "lunchFriday" | "lunchSaturday";
                  const checked = formData[fieldKey];
                  const isSaturday = fieldKey === "lunchSaturday";
                  return (
                    <div key={day.key} className="space-y-2">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => setFormData({ ...formData, [fieldKey]: !checked, ...(isSaturday && checked ? { lunchSaturdayNoPickles: false } : {}) })}
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? 'bg-primary border-primary' : 'border-border'}`}
                        >
                          {checked && (
                            <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <span className="text-sm font-normal text-foreground">
                          {day.label} Lunch{" "}
                          <span className="text-muted-foreground">({day.date})</span>
                          {" — "}${day.price}
                          {isSaturday && (
                            <span className="text-muted-foreground"> · Chick-fil-A sandwich</span>
                          )}
                        </span>
                      </label>
                      {isSaturday && checked && (
                        <div className="ml-9 flex flex-wrap items-center gap-x-5 gap-y-2">
                          <span className="text-sm text-muted-foreground">Pickles?</span>
                          {[
                            { value: false, label: "With pickles" },
                            { value: true, label: "No pickles" },
                          ].map((opt) => {
                            const selected = formData.lunchSaturdayNoPickles === opt.value;
                            return (
                              <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  onClick={() => setFormData({ ...formData, lunchSaturdayNoPickles: opt.value })}
                                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${selected ? 'border-primary' : 'border-border'}`}
                                >
                                  {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                                </button>
                                <span className="text-sm font-normal text-foreground">{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-sm text-muted-foreground pt-1">
                  Not sure yet? Check the days you might eat &mdash; we&apos;d rather
                  over-plan. You can adjust at check-in.
                </p>
              </div>
            </div>

            {/* Additional Options */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Additional Options
              </h2>

              <div className="space-y-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.firstNationals}
                    onClick={() => setFormData({...formData, firstNationals: !formData.firstNationals})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.firstNationals ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.firstNationals && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-sm font-normal text-foreground">
                    Is this your first National tournament?
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.ironManInterest}
                    onClick={() => setFormData({...formData, ironManInterest: !formData.ironManInterest})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.ironManInterest ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.ironManInterest && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-sm font-normal text-foreground">
                    Will you be playing in the Iron Man side event?
                  </span>
                </label>

                <label className="flex items-start space-x-3 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.fantasyDraftOptIn}
                    onClick={() => setFormData({...formData, fantasyDraftOptIn: !formData.fantasyDraftOptIn})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.fantasyDraftOptIn ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.fantasyDraftOptIn && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1">
                    <span className="text-sm font-normal text-foreground">
                      Would you like to be a draftable player in the Fantasy
                      Draft?
                    </span>
                    <p className="text-sm text-muted-foreground">
                      All players who opt in will be entered into a drawing for
                      a box of the new set even if they are not drafted
                    </p>
                  </div>
                </label>

                <label className="flex items-start space-x-3 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.needsAirportTransportation}
                    onClick={() => setFormData({...formData, needsAirportTransportation: !formData.needsAirportTransportation})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.needsAirportTransportation ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.needsAirportTransportation && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1">
                    <span className="text-sm font-normal text-foreground">
                      Will you need transportation to/from{" "}
                      <a
                        href="https://maps.app.goo.gl/JSoAe6ex487NL9pU9"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.preventDefault()}
                      >
                        Bluegrass International Airport
                      </a>
                      ?
                    </span>
                    <p className="text-sm text-muted-foreground">
                      Shuttle times are TBD but will be sent via email when determined
                    </p>
                  </div>
                </label>

                <label className="flex items-start space-x-3 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.needsHotelTransportation}
                    onClick={() => setFormData({...formData, needsHotelTransportation: !formData.needsHotelTransportation})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.needsHotelTransportation ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.needsHotelTransportation && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1">
                    <span className="text-sm font-normal text-foreground">
                      Will you need transportation between the official hotel
                      and the venue?
                    </span>
                    <p className="text-sm text-muted-foreground">
                      Shuttle times are TBD but will be sent via email when determined
                    </p>
                  </div>
                </label>

                {/* Overnight Stay Section */}
                <label className="flex items-start space-x-3 pt-2 cursor-pointer">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={formData.stayingOvernight}
                    onClick={() => {
                      const newStayingOvernight = !formData.stayingOvernight;
                      setFormData({
                        ...formData,
                        stayingOvernight: newStayingOvernight,
                        overnightStayNights: newStayingOvernight ? formData.overnightStayNights : []
                      });
                    }}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${formData.stayingOvernight ? 'bg-primary border-primary' : 'border-border'}`}
                  >
                    {formData.stayingOvernight && (
                      <svg className="w-4 h-4 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1">
                    <span className="text-sm font-normal text-foreground">
                      Do you plan to stay overnight at the venue?
                    </span>
                    <p className="text-sm text-muted-foreground">
                      Help us plan for overnight accommodations
                    </p>
                  </div>
                </label>

                {/* Overnight Stay Nights Selection */}
                {formData.stayingOvernight && (
                  <div className="ml-9 mt-3 space-y-2 p-4 bg-card rounded-lg border-2 border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">
                      Which nights do you plan to stay?
                    </p>
                    {NATIONALS_CONFIG.overnightStayNights.map((night) => (
                      <label key={night.value} className="flex items-center space-x-3 cursor-pointer">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={formData.overnightStayNights.includes(night.value)}
                          onClick={() => {
                            const nights = formData.overnightStayNights.includes(night.value)
                              ? formData.overnightStayNights.filter(n => n !== night.value)
                              : [...formData.overnightStayNights, night.value];
                            setFormData({...formData, overnightStayNights: nights});
                          }}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            formData.overnightStayNights.includes(night.value)
                              ? 'bg-primary border-primary'
                              : 'border-muted-foreground'
                          }`}
                        >
                          {formData.overnightStayNights.includes(night.value) && (
                            <svg className="w-3 h-3 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <span className="font-normal text-sm text-foreground">
                          {night.label}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Payment Information */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Payment Information
              </h2>
              <div className="p-4 bg-primary/10 text-foreground rounded-lg border border-primary/30">
                <p className="font-medium mb-2">💳 Payment at Venue</p>
                <p className="text-sm">
                  Payment is to be received at the venue (no pre-payment options). Accepted payment methods:
                </p>
                <ul className="text-sm mt-2 ml-4 space-y-1">
                  <li>• Cash</li>
                  <li>• Brian's Venmo</li>
                  <li>• Brian's PayPal</li>
                </ul>
                <p className="text-sm mt-2 text-muted-foreground">
                  Venmo and PayPal details will be provided closer to the event.
                </p>
              </div>
            </div>

            {/* Status Messages */}
            {submitStatus.type && (
              <div
                className={`p-4 rounded-lg ${
                  submitStatus.type === "success"
                    ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
                }`}
              >
                {submitStatus.message}
              </div>
            )}

            {/* Submit Button */}
              <div className="pt-4 flex justify-center">
                <Button
                  type="submit"
                  disabled={isSubmitting || isUploadingPhoto}
                  variant="outline"
                  className="border-2 border-primary text-primary hover:bg-primary/10 hover:border-primary/80"
                  size="lg"
                >
                  {isUploadingPhoto ? "Uploading picture..." : isSubmitting ? "Submitting..." : "Submit Registration"}
                </Button>
              </div>
            </form>
          </div>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
