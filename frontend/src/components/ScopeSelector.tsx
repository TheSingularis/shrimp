import { type Scope } from "../api";

interface Props {
    scopes: Scope[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

export function ScopeSelector({ scopes, selected, onChange }: Props) {
    function toggle(name: string) {
        onChange(
            selected.includes(name)
                ? selected.filter((s) => s !== name)
                : [...selected, name]
        );
    }

    return (
        <div className="scope-selector">
            {scopes
                .filter((s) => s.enabled)
                .map((s) => (
                    <button
                        key={s.name}
                        className={`scope-pill ${selected.includes(s.name) ? "active" : ""}`}
                        onClick={() => toggle(s.name)}
                    >
                        {s.name}
                    </button>
                ))}
        </div>
    );
}
