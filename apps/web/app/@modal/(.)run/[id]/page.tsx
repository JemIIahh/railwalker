import { Notice } from '../../../../components/notice';
import { RunView } from '../../../../components/run-view';
import { Sheet } from '../../../../components/sheet';
import { getData } from '../../../../lib/data';
import { loadRun } from '../../../../lib/load';

export const revalidate = 300;

export function generateStaticParams(): { id: string }[] {
  return [];
}

interface Props {
  params: Promise<{ id: string }>;
}

/** The same run as its own page, but slid in over the page it was opened from, so the map stays where it was. */
export default async function RunSheet({ params }: Props) {
  const { id } = await params;
  const loaded = await loadRun(getData(), id);
  return (
    <Sheet label="Replay of a run">
      {loaded.state === 'ready' ? <RunView run={loaded.value} as="h2" /> : <Notice loaded={loaded} what="run" />}
    </Sheet>
  );
}
