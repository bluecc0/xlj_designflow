import React from 'react'
import { PageDropdown } from './PageDropdown'

interface Props {
  saveStatus: 'saved' | 'saving' | 'error'
}

export function TopBar({ saveStatus }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 18,
        left: 18,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 4px',
        backgroundColor: 'rgba(255, 255, 255, 0.86)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 9999,
        border: '1px solid #e7e9ee',
        boxShadow: '0 12px 34px rgba(20, 47, 95, 0.10), 0 2px 6px rgba(20, 47, 95, 0.04)',
        userSelect: 'none',
      }}
    >
      {/* 仅保留：画板名称下拉选择器 */}
      <PageDropdown />

      {/* 状态指示 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 4, borderLeft: '1px solid #e7e9ee' }}>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: saveStatus === 'saving' ? '#f59e0b' : saveStatus === 'error' ? '#ef4444' : '#10b981',
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 500, color: '#687083' }}>
          {saveStatus === 'saving' ? '保存中' : saveStatus === 'error' ? '保存失败' : '已保存'}
        </span>
      </div>
    </div>
  )
}
