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
  buttonClassName = "flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 text-sm text-slate-700 transition-[border-color,background-color,color,box-shadow] hover:border-slate-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700/80 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900",
  dropdownClassName = "left-0",
  hideChevron = false,
  hideLabelDisplay = false,
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
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClassName}
      >
        {!hideLabelDisplay && <span className="truncate">{selectedOption.label}</span>}
        {!hideChevron && (
          <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${!hideLabelDisplay ? 'ml-2' : ''} ${isOpen ? 'rotate-180 text-blue-500 dark:text-blue-400' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div className={`absolute z-50 mt-1.5 min-w-[150px] overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 py-1.5 shadow-xl shadow-slate-200/60 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95 dark:shadow-black/40 animate-in slide-in-from-top-2 fade-in duration-200 ${dropdownClassName}`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors
                ${value === option.value 
                  ? 'bg-blue-50 text-blue-600 font-semibold dark:bg-blue-500/10 dark:text-blue-300' 
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}`}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={14} className="ml-3 text-blue-500 dark:text-blue-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
