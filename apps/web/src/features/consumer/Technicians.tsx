import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LocateFixed, MapPin, ShieldAlert, ShieldCheck, Star } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { Badge, Button, Card, EmptyState, Notice, PageHeader, Select, Skeleton } from '../../ui';

export default function TechniciansPage() {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState('50');
  const [geoError, setGeoError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['technicians', geo, radius], queryFn: () => api.get(`/auth/technicians${qs(geo ? { lat: geo.lat, lng: geo.lng, radiusKm: radius } : {})}`) });
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => (setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }), setGeoError(null)),
      () => setGeoError('Location unavailable — showing all technicians.'),
    );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Professional help"
        title="Find a technician"
        description="Repair professionals on REPAIRVERSE. A “Verified” badge appears only after an administrator has reviewed their credentials."
        actions={
          <div className="flex gap-2">
            {geo && (
              <Select value={radius} onChange={(e) => setRadius(e.target.value)} className="w-32">
                {['10', '25', '50', '100', '250'].map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </Select>
            )}
            <Button variant="secondary" onClick={locate} icon={<LocateFixed className="h-4 w-4" />}>
              {geo ? 'Update location' : 'Near me'}
            </Button>
          </div>
        }
      />
      {geoError && <Notice tone="warn">{geoError}</Notice>}
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.data?.technicians?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.technicians.map((t: any) => (
            <Card key={t.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{t.business_name ?? t.display_name}</div>
                  <div className="text-sm text-ink-muted">{t.headline ?? t.display_name}</div>
                </div>
                {t.verification_status === 'verified' ? (
                  <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>Verified</Badge>
                ) : (
                  <Badge icon={<ShieldAlert className="h-3 w-3" />}>Credentials not verified</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                {t.service_area && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {t.service_area}
                  </span>
                )}
                {t.distance_km != null && <span>{t.distance_km} km away</span>}
                {t.years_experience != null && <span>{t.years_experience} yrs experience (self-reported)</span>}
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {t.review_count ? `${t.rating} (${t.review_count} reviews)` : 'No reviews yet'}
                </span>
              </div>
              {t.specialties?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {t.specialties.map((s: string) => (
                    <span key={s} className="rounded-full bg-paper-sunken px-2.5 py-1 text-xs">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No technicians found" description={geo ? 'Try a larger radius.' : undefined} />
      )}
    </div>
  );
}
