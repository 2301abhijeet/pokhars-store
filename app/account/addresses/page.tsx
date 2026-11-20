"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  deleteCustomerAddress,
  makeCustomerAddressDefault,
  saveCustomerAddress,
  subscribeToCustomerAddresses,
  type AddressInput,
  type CustomerAddress,
} from "@/lib/firebase/addresses";

type FormState = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

const emptyForm: FormState = {
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};

function toForm(address: CustomerAddress): FormState {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? "",
    landmark: address.landmark ?? "",
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

function validateForm(form: FormState): string | null {
  if (!form.recipientName.trim()) return "Enter the recipient's full name.";
  if (!/^\+?[0-9\s-]{10,15}$/.test(form.phone.trim())) return "Enter a valid phone number (10–15 digits).";
  if (!form.line1.trim()) return "Enter the house number and street address.";
  if (!form.city.trim()) return "Enter the city or town.";
  if (!form.state.trim()) return "Enter the state.";
  if (!/^[1-9][0-9]{5}$/.test(form.pincode.trim())) return "Enter a valid 6-digit Indian PIN code.";
  return null;
}

export default function AddressesPage() {
  const { user, loading: authLoading } = useAuth();
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAddresses([]);
      setAddressesLoading(false);
      return;
    }

    setAddressesLoading(true);
    const unsubscribe = subscribeToCustomerAddresses(
      user.uid,
      (nextAddresses) => {
        setAddresses(nextAddresses);
        setAddressesLoading(false);
      },
      (cause) => {
        setError(cause.message || "Your saved addresses could not be loaded.");
        setAddressesLoading(false);
      },
    );

    return unsubscribe;
  }, [user, authLoading]);

  const updateField = useCallback(
    (field: keyof FormState, value: string | boolean) => {
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  function startAdd() {
    setEditingId(null);
    setForm({ ...emptyForm, isDefault: addresses.length === 0 });
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function startEdit(address: CustomerAddress) {
    setEditingId(address.id);
    setForm(toForm(address));
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function cancelForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload: AddressInput = {
      ...form,
      recipientName: form.recipientName.trim(),
      phone: form.phone.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim(),
      landmark: form.landmark.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: form.pincode.trim(),
      isDefault: form.isDefault,
    };

    try {
      await saveCustomerAddress(user.uid, editingId, payload);
      setSuccess(editingId ? "Address updated successfully." : "Address saved successfully.");
      cancelForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Address could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMakeDefault(addressId: string) {
    if (!user) return;
    setBusyId(addressId);
    setError(null);
    setSuccess(null);
    try {
      await makeCustomerAddressDefault(user.uid, addressId);
      setSuccess("Default delivery address updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Default address could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(address: CustomerAddress) {
    if (!user) return;
    const confirmed = window.confirm(
      `Delete the delivery address for ${address.recipientName} at ${address.city}?`,
    );
    if (!confirmed) return;

    setBusyId(address.id);
    setError(null);
    setSuccess(null);
    try {
      await deleteCustomerAddress(user.uid, address.id);
      setSuccess("Address deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Address could not be deleted.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="site-shell address-page">
      <div className="announcement">
        <span>MADE IN BIHAR</span><b>✳</b><span>YOUR DETAILS, YOUR WAY</span><b>✳</b><span>SNACK HAPPY</span>
      </div>

      <header className="site-header address-header">
        <Link className="brand" href="/">
          <span className="brand-mark">P</span>
          <span className="brand-word">POKHAR’S</span>
          <span className="brand-sub">MAKHANA WITH A MOOD</span>
        </Link>
        <Link className="address-back-link" href="/">BACK TO SHOP ↗</Link>
      </header>

      <section className="addresses-content">
        <div className="addresses-heading">
          <div>
            <p className="section-kicker">YOUR ACCOUNT</p>
            <h1>Delivery <span>addresses</span></h1>
            <p className="addresses-subtitle">
              Keep your favourite delivery spots handy for a quicker checkout.
            </p>
            {user?.email && <p className="addresses-user">{user.email}</p>}
          </div>
          {!formOpen && user && (
            <button className="address-primary-button" type="button" onClick={startAdd}>
              <b>+</b> ADD NEW ADDRESS
            </button>
          )}
        </div>

        {authLoading ? (
          <div className="addresses-empty">Checking your account…</div>
        ) : !user ? (
          <div className="addresses-empty">
            <span className="addresses-empty-icon">⌂</span>
            <h2>Sign in to manage your addresses.</h2>
            <p>Your saved delivery addresses are private to your POKHAR’S account.</p>
            <Link className="address-primary-button" href="/">GO TO SIGN IN ↗</Link>
          </div>
        ) : (
          <>
            {error && <p className="address-message is-error" role="alert">{error}</p>}
            {success && <p className="address-message is-success" role="status">{success}</p>}

            {formOpen && (
              <form className="address-form-card" onSubmit={handleSubmit}>
                <div className="address-form-heading">
                  <div>
                    <p className="section-kicker">DELIVERY DETAILS</p>
                    <h2>{editingId ? "Edit address" : "Add a new address"}</h2>
                  </div>
                  <button className="address-text-button" type="button" onClick={cancelForm}>CANCEL</button>
                </div>

                <div className="address-fields-grid">
                  <label className="address-field">
                    <span>RECIPIENT NAME *</span>
                    <input autoComplete="name" value={form.recipientName} onChange={(event) => updateField("recipientName", event.target.value)} placeholder="Full name" maxLength={80} required />
                  </label>
                  <label className="address-field">
                    <span>MOBILE NUMBER *</span>
                    <input autoComplete="tel" inputMode="tel" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="10-digit mobile number" maxLength={15} required />
                  </label>
                  <label className="address-field address-field-wide">
                    <span>HOUSE / FLAT / STREET *</span>
                    <input autoComplete="address-line1" value={form.line1} onChange={(event) => updateField("line1", event.target.value)} placeholder="House no., building, street" maxLength={160} required />
                  </label>
                  <label className="address-field">
                    <span>AREA / LOCALITY</span>
                    <input autoComplete="address-line2" value={form.line2} onChange={(event) => updateField("line2", event.target.value)} placeholder="Locality or area" maxLength={100} />
                  </label>
                  <label className="address-field">
                    <span>LANDMARK</span>
                    <input value={form.landmark} onChange={(event) => updateField("landmark", event.target.value)} placeholder="Nearby landmark (optional)" maxLength={100} />
                  </label>
                  <label className="address-field">
                    <span>CITY / TOWN *</span>
                    <input autoComplete="address-level2" value={form.city} onChange={(event) => updateField("city", event.target.value)} placeholder="City" maxLength={80} required />
                  </label>
                  <label className="address-field">
                    <span>STATE *</span>
                    <input autoComplete="address-level1" value={form.state} onChange={(event) => updateField("state", event.target.value)} placeholder="State" maxLength={80} required />
                  </label>
                  <label className="address-field">
                    <span>PIN CODE *</span>
                    <input autoComplete="postal-code" inputMode="numeric" value={form.pincode} onChange={(event) => updateField("pincode", event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="6-digit PIN code" maxLength={6} required />
                  </label>
                </div>

                <label className="address-default-check">
                  <input type="checkbox" checked={form.isDefault} onChange={(event) => updateField("isDefault", event.target.checked)} />
                  <span>Set as my default delivery address</span>
                </label>

                {error && <p className="address-message is-error" role="alert">{error}</p>}

                <div className="address-form-actions">
                  <button className="address-primary-button" type="submit" disabled={saving}>
                    {saving ? "SAVING…" : editingId ? "SAVE CHANGES" : "SAVE ADDRESS"}
                  </button>
                  <button className="address-text-button" type="button" onClick={cancelForm} disabled={saving}>CANCEL</button>
                </div>
              </form>
            )}

            {addressesLoading ? (
              <div className="addresses-empty">Loading your saved addresses…</div>
            ) : addresses.length === 0 && !formOpen ? (
              <div className="addresses-empty">
                <span className="addresses-empty-icon">⌂</span>
                <h2>No delivery addresses saved yet.</h2>
                <p>Add an address now. You can change it any time before checkout.</p>
                <button className="address-primary-button" type="button" onClick={startAdd}>ADD YOUR FIRST ADDRESS</button>
              </div>
            ) : (
              <div className="addresses-grid">
                {addresses.map((address) => (
                  <article className="saved-address-card" key={address.id}>
                    <div className="saved-address-top">
                      <span className="saved-address-icon">⌂</span>
                      {address.isDefault && <span className="default-address-badge">DEFAULT</span>}
                    </div>
                    <h2>{address.recipientName}</h2>
                    <p className="saved-address-phone">{address.phone}</p>
                    <p className="saved-address-lines">
                      {address.line1}
                      {address.line2 && <><br />{address.line2}</>}
                      {address.landmark && <><br />Near {address.landmark}</>}
                      <br />{address.city}, {address.state} – {address.pincode}
                      <br />India
                    </p>
                    <div className="saved-address-actions">
                      {!address.isDefault && (
                        <button className="address-text-button" type="button" disabled={busyId === address.id} onClick={() => void handleMakeDefault(address.id)}>
                          {busyId === address.id ? "PLEASE WAIT…" : "MAKE DEFAULT"}
                        </button>
                      )}
                      <button className="address-text-button" type="button" disabled={busyId === address.id} onClick={() => startEdit(address)}>EDIT</button>
                      <button className="address-delete-button" type="button" disabled={busyId === address.id} onClick={() => void handleDelete(address)}>DELETE</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <footer className="site-footer address-footer">
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} POKHAR’S. ALL RIGHTS RESERVED.</span>
          <Link href="/">BACK TO SHOP ↑</Link>
        </div>
      </footer>
    </main>
  );
}
