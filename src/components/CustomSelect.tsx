import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  label: string;
  value: string;
}

interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  // 外层包裹器样式
  className?: string;
  // 按钮自身样式
  buttonClassName?: string;
  // 下拉面板样式
  dropdownClassName?: string;
  // 是否隐藏右侧默认的箭头
  hideChevron?: boolean;
  // 是否隐藏当前选中项目的文字标签（只显示箭头）
  hideLabelDisplay?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ 
  value, 
  options, 
  onChange, 
  className = "",
  buttonClassName = "flex items-center justify-between w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors",
  dropdownClassName = "left-0",
  hideChevron = false,
  hideLabelDisplay = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClassName}
      >
        {!hideLabelDisplay && <span className="truncate">{selectedOption.label}</span>}
        {!hideChevron && (
          <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 text-slate-400 ${!hideLabelDisplay ? 'ml-2' : ''} ${isOpen ? 'rotate-180 text-blue-400' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div className={`absolute z-50 mt-1.5 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden py-1.5 min-w-[150px] animate-in slide-in-from-top-2 fade-in duration-200 ${dropdownClassName}`}>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors
                ${value === option.value 
                  ? 'bg-blue-600/10 text-blue-400 font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700/80 hover:text-white'}`}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={14} className="text-blue-500 ml-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
