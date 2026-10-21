import { TryIt } from './try-it';

export default function Home() {
  return (
    <>
      <h1>Is your x402 endpoint ready to be paid?</h1>
      <p className="lede">Paste a URL. Railwalker asks for its price, once, without paying, and tells you what a buyer would hit.</p>
      <TryIt />
    </>
  );
}
