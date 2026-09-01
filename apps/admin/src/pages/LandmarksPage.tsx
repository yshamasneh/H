import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  createLandmark,
  deleteLandmark,
  listLandmarks,
  updateLandmark,
  type Landmark
} from "../api";
import { LeafletPicker, type PickerCoordinate } from "../components/LeafletPicker";

// The Biddu-enclave service area (Qatanna, Al-Qubeiba, Biddu, Beit Anan, Beit
// Surik, Beit Ijza) — a sensible starting view for a new landmark before the admin taps.
const defaultCoordinate: PickerCoordinate = { latitude: 31.83804, longitude: 35.14047 };

export function LandmarksPage() {
  const { t } = useTranslation();
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [coordinate, setCoordinate] = useState<PickerCoordinate>(defaultCoordinate);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setLandmarks(await listLandmarks());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("landmarks.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setCoordinate(defaultCoordinate);
  }

  function startEdit(landmark: Landmark) {
    setEditingId(landmark.id);
    setName(landmark.name);
    setCoordinate({ latitude: landmark.latitude, longitude: landmark.longitude });
  }

  async function save() {
    if (name.trim().length < 2) {
      setError(t("landmarks.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), latitude: coordinate.latitude, longitude: coordinate.longitude };
      if (editingId) {
        await updateLandmark(editingId, body);
        setNotice(t("landmarks.updatedNotice"));
      } else {
        await createLandmark(body);
        setNotice(t("landmarks.createdNotice"));
      }
      resetForm();
      await load();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(landmark: Landmark) {
    setBusy(true);
    try {
      await deleteLandmark(landmark.id);
      if (editingId === landmark.id) resetForm();
      await load();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  }

  // Show the other landmarks on the picker for context, minus the one being edited (its own
  // draggable marker already represents it).
  const otherMarkers = useMemo(
    () =>
      (landmarks ?? [])
        .filter((item) => item.id !== editingId)
        .map((item) => ({ id: item.id, title: item.name, latitude: item.latitude, longitude: item.longitude })),
    [landmarks, editingId]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("landmarks.title")}</h1>
          <p className="page-subtitle">{t("landmarks.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <div className="card">
        <h2 className="card-title">{editingId ? t("landmarks.editTitle") : t("landmarks.createTitle")}</h2>
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setName(event.target.value)}
            placeholder={t("landmarks.namePlaceholder")}
            value={name}
          />
        </div>
        <p className="page-subtitle">{t("landmarks.mapHint")}</p>
        <LeafletPicker markers={otherMarkers} onChange={setCoordinate} value={coordinate} />
        <div className="empty-state">
          {t("landmarks.coordinates", {
            lat: coordinate.latitude.toFixed(5),
            lng: coordinate.longitude.toFixed(5)
          })}
        </div>
        <div className="btn-row">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || name.trim().length < 2}
            onClick={() => void save()}
            type="button"
          >
            {editingId ? t("landmarks.saveChanges") : t("landmarks.create")}
          </button>
          {editingId ? (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={resetForm} type="button">
              {t("common.cancel")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="card">
        {landmarks === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : landmarks.length === 0 ? (
          <div className="empty-state">{t("landmarks.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("landmarks.name")}</th>
                <th>{t("landmarks.latitude")}</th>
                <th>{t("landmarks.longitude")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {landmarks.map((landmark) => (
                <tr key={landmark.id}>
                  <td>{landmark.name}</td>
                  <td>{landmark.latitude.toFixed(5)}</td>
                  <td>{landmark.longitude.toFixed(5)}</td>
                  <td>
                    <div className="btn-row">
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => startEdit(landmark)}
                        type="button"
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => void remove(landmark)}
                        type="button"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
