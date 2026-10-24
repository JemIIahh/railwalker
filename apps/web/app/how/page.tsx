export const metadata = { title: 'Methodology · Railwalker' };

export default function Methodology() {
  return (
    <>
      <h1>How Railwalker decides</h1>
      <h2>What a scan does</h2>
      <p>One unpaid request to the URL you give it. It reads the 402 challenge, runs static checks on the payment options, and reports what a buyer would hit. It never pays, and it never follows a redirect to somewhere it has not checked.</p>
      <h2>Predicted and confirmed</h2>
      <p>
        <strong>Predicted</strong> means read from the challenge: nothing was paid. <strong>Confirmed</strong> means a real payment was made on Celo mainnet and what came back was checked, including the settlement on chain. The two are never blended, and there is no score: a verdict is the worst thing found.
      </p>
      <h2>What it will not touch</h2>
      <ul>
        <li>Private, local and credentialed addresses are refused before any request is sent.</li>
        <li>Anything that looks like it does something in the world (sends, books, deletes, swaps) is never paid.</li>
        <li>A seller can opt out by serving a plain-text file at <code>/.well-known/railwalker-optout</code>.</li>
        <li>The Celo Sepolia sandbox entry that some sellers list is never paid.</li>
      </ul>
      <h2>Privacy</h2>
      <p>Sellers nobody asked us to check appear only in aggregate counts, never by name.</p>
    </>
  );
}
