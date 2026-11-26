import { BrandMark } from "@/components/brand-mark";
import { ActivityBar, Spinner } from "@/components/ui/loaders";

export default function RootLoading() {
  return (
    <div className="ps-route-loader" role="status" aria-label="Loading PatchSignal">
      <div className="ps-route-loader__box">
        <div className="ps-route-loader__brand">
          <BrandMark size={28} animated />
          <span>PatchSignal</span>
          <Spinner size={16} />
        </div>
        <ActivityBar label="Loading application" />
      </div>
    </div>
  );
}
