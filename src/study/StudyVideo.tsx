import { Button } from "@nextui-org/react";
import { useStudyStore } from "./StudyModel";
import { useT } from "../i18n";

export default function StudyVideo(props: { video: string }) {
  const t = useT();
  const nextStep = useStudyStore(state => state.nextStep);

  return <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
  <video width={'80%'} height={'80%'} controls>
    <source src={props.video} type="video/mp4" />
    {t('Your browser does not support the video tag.')}
  </video>
  <div style={{ width: '80%', display: "flex", justifyContent: "right" }}>
              <Button style={{ marginTop: 15, marginBottom: 40, padding: 20 }} onClick={(e) => {
            useStudyStore.getState().logEvent("NEXT_PRESSED");
            nextStep();
          }}>{t('Next')}</Button>
  </div>
</div>
}
