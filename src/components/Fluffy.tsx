"use client";

import { motion } from "framer-motion";
import { useState } from "react";

export default function Fluffy() {
  const [isDancing, setIsDancing] = useState(false);

  return (
    <div className="absolute right-10 bottom-32 z-50 cursor-pointer hidden lg:block group"
         onMouseEnter={() => setIsDancing(true)}
         onMouseLeave={() => setIsDancing(false)}
         onClick={() => setIsDancing(true)}
    >
      <motion.div
        animate={
          isDancing
            ? {
                y: [0, -40, 0, -20, 0],
                rotate: [0, -15, 15, -10, 0],
                scale: [1, 1.2, 0.9, 1.1, 1],
              }
            : {
                y: [0, -10, 0],
              }
        }
        transition={
          isDancing
            ? { duration: 0.6, ease: "easeInOut", times: [0, 0.2, 0.5, 0.8, 1] }
            : { duration: 4, repeat: Infinity, ease: "easeInOut" }
        }
        className="relative w-24 h-24"
      >
        {/* Glow effect */}
        <div className="absolute inset-0 bg-accent-secondary/20 blur-xl rounded-full" />
        
        {/* Body */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-accent to-accent-secondary rounded-full flex items-center justify-center overflow-hidden border border-white/20 shadow-lg">
            {/* Eyes */}
            <div className="flex gap-3 -mt-2">
                <motion.div 
                    animate={isDancing ? { scaleY: [1, 0.1, 1] } : { scaleY: 1 }}
                    transition={{ duration: 0.2, repeat: isDancing ? 2 : 0 }}
                    className="w-3.5 h-5 bg-white rounded-full flex justify-center items-center shadow-inner"
                >
                    <div className="w-2 h-2.5 bg-background rounded-full translate-x-0.5" />
                </motion.div>
                <motion.div 
                    animate={isDancing ? { scaleY: [1, 0.1, 1] } : { scaleY: 1 }}
                    transition={{ duration: 0.2, repeat: isDancing ? 2 : 0, delay: 0.05 }}
                    className="w-3.5 h-5 bg-white rounded-full flex justify-center items-center shadow-inner"
                >
                    <div className="w-2 h-2.5 bg-background rounded-full translate-x-0.5" />
                </motion.div>
            </div>
            {/* Beak / Mouth */}
            <div className="absolute top-[55%] w-4 h-3 bg-yellow-400 rounded-full shadow-inner" />
        </div>
      </motion.div>
      
      {/* Tooltip / Speech bubble */}
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.8 }}
        animate={{ opacity: isDancing ? 1 : 0, y: isDancing ? -20 : 10, scale: isDancing ? 1 : 0.8 }}
        className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap bg-surface-2 border border-border text-xs px-3 py-1.5 rounded-lg text-accent-secondary font-mono shadow-xl pointer-events-none"
      >
        Let's Build! 🚀
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-surface-2 border-b border-r border-border rotate-45" />
      </motion.div>
    </div>
  );
}
