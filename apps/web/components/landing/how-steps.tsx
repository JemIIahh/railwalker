import { Bird } from '../bird';
import { Coin } from '../coin';
import { Icon } from '../icons';

/** Three steps, drawn rather than described. */
export function HowSteps() {
  return (
    <div className="steps">
      <article className="step card tint-lilac">
        <div className="step-art art-paste" aria-hidden="true">
          <div className="mock-bar">
            <Icon name="link" size={16} />
            <span>https://my-api.com/data</span>
          </div>
          <span className="mock-btn">Check</span>
        </div>
        <span className="step-n">1</span>
        <h3 className="h3">Paste a link</h3>
        <p>Any paid API on Celo.</p>
      </article>
      <article className="step card tint-butter">
        <div className="step-art art-try" aria-hidden="true">
          <Bird size={96} />
          <span className="try-coin">
            <Coin symbol="USAT" size={34} />
          </span>
          <span className="try-gate" />
        </div>
        <span className="step-n">2</span>
        <h3 className="h3">The bird tries to pay it</h3>
        <p>Real money, a few cents.</p>
      </article>
      <article className="step card tint-mint">
        <div className="step-art art-report" aria-hidden="true">
          <div className="mock-report">
            <span className="mock-ok">
              <Icon name="check" size={18} strokeWidth={3} />
            </span>
            <i />
            <i />
            <i style={{ width: '60%' }} />
          </div>
        </div>
        <span className="step-n">3</span>
        <h3 className="h3">You get a clear answer</h3>
        <p>What works, what breaks, how to fix it.</p>
      </article>
    </div>
  );
}
